import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { runEscalator } from '@/lib/ai/escalator'
import {
  computeAdherenceRate,
  computeDriftScore,
  computeCheckInInterval,
} from '@/lib/signals'
import { timingSafeEqual } from 'crypto'

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export async function GET(request: NextRequest) {
  try {
    // Verify CRON_SECRET with timing-safe comparison
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret || !authHeader || !safeCompare(authHeader, `Bearer ${cronSecret}`)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminClient()

    // Load all active cases
    const { data: cases, error: casesError } = await admin
      .from('cases')
      .select('*')
      .eq('status', 'active')

    if (casesError || !cases) {
      return NextResponse.json({ error: 'Failed to load cases' }, { status: 500 })
    }

    let processed = 0
    let checkInsTriggered = 0
    let escalationsCreated = 0

    const now = new Date()
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    for (const caseData of cases) {
      try {
        const policies = caseData.policies as {
          escalation_drift_threshold: number
          escalation_failure_threshold: number
          min_check_in_interval_hours: number
          max_check_in_interval_hours: number
        }

        // Step 1: Count check-ins in last 7 days
        const { count: checkInCount } = await admin
          .from('check_ins')
          .select('*', { count: 'exact', head: true })
          .eq('case_id', caseData.id)
          .gte('created_at', sevenDaysAgo.toISOString())

        // Step 2: Compute adherence_rate
        const adherenceRate = computeAdherenceRate(
          checkInCount || 0,
          caseData.check_in_interval_hours || 24
        )

        // Step 3: Get latest check-in for sentiment
        const { data: latestCheckIn } = await admin
          .from('check_ins')
          .select('ai_parsed_signals, created_at')
          .eq('case_id', caseData.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        const lastSignals = latestCheckIn?.ai_parsed_signals as {
          sentiment?: string
          overwhelm_level?: number
        } | null

        const lastSentiment = lastSignals?.sentiment || null
        const overwhelmScore = lastSignals?.overwhelm_level || 0

        // Compute hours since last check-in
        let hoursSinceLastCheckIn: number | null = null
        if (caseData.last_check_in_at) {
          hoursSinceLastCheckIn =
            (now.getTime() - new Date(caseData.last_check_in_at).getTime()) /
            (1000 * 60 * 60)
        }

        // Step 4: Count tasks with high failure count
        const { data: highFailureTasks } = await admin
          .from('tasks')
          .select('id')
          .eq('case_id', caseData.id)
          .gte('failure_count', 2)
          .in('status', ['pending', 'active', 'stuck'])

        // Step 5: Compute drift_score
        const driftScore = computeDriftScore({
          adherenceRate,
          tasksWithHighFailure: highFailureTasks?.length || 0,
          hoursSinceLastCheckIn,
          lastSentiment,
        })

        // Step 6: Compute check_in_interval_hours
        const newCheckInInterval = computeCheckInInterval(adherenceRate, driftScore, {
          min_check_in_interval_hours: policies.min_check_in_interval_hours,
          max_check_in_interval_hours: policies.max_check_in_interval_hours,
        })

        // Step 7: Update case with computed values
        await admin
          .from('cases')
          .update({
            drift_score: driftScore,
            overwhelm_score: overwhelmScore,
            adherence_rate: adherenceRate,
            check_in_interval_hours: newCheckInInterval,
          })
          .eq('id', caseData.id)

        // Step 8: Check if check-in should be triggered
        const baseTime = caseData.last_check_in_at || caseData.created_at
        if (baseTime) {
          const hoursSinceBase =
            (now.getTime() - new Date(baseTime).getTime()) / (1000 * 60 * 60)

          if (hoursSinceBase >= newCheckInInterval && !caseData.awaiting_check_in) {
            await admin
              .from('cases')
              .update({ awaiting_check_in: true })
              .eq('id', caseData.id)
            checkInsTriggered++
          }
        }

        // Step 9: Check escalation triggers
        const shouldEscalateDrift =
          driftScore > (policies.escalation_drift_threshold || 0.7)

        // Check for inactivity (5+ days)
        const daysSinceLastCheckIn = hoursSinceLastCheckIn
          ? hoursSinceLastCheckIn / 24
          : null
        const isInactive = daysSinceLastCheckIn !== null && daysSinceLastCheckIn >= 5

        if (shouldEscalateDrift || isInactive) {
          // Check if there's already an unresolved escalation for this case
          const { data: existingEscalation } = await admin
            .from('escalations')
            .select('id')
            .eq('case_id', caseData.id)
            .is('coach_action', null)
            .limit(1)
            .single()

          // Only create new escalation if no unresolved one exists
          if (!existingEscalation) {
            try {
              // Load tasks and check-ins for escalator context
              const { data: caseTasks } = await admin
                .from('tasks')
                .select('*')
                .eq('case_id', caseData.id)
                .in('status', ['pending', 'active', 'stuck'])

              const { data: caseCheckIns } = await admin
                .from('check_ins')
                .select('*')
                .eq('case_id', caseData.id)
                .order('created_at', { ascending: false })
                .limit(5)

              const { data: activePlan } = await admin
                .from('plans')
                .select('*')
                .eq('case_id', caseData.id)
                .eq('is_active', true)
                .single()

              let triggerReason: string
              if (isInactive) {
                triggerReason = `Client inactive for ${Math.floor(daysSinceLastCheckIn!)} days`
              } else {
                triggerReason = `Drift score (${driftScore.toFixed(2)}) exceeds threshold (${policies.escalation_drift_threshold})`
              }

              const whatAiTried: string[] = []
              if (newCheckInInterval < 24) {
                whatAiTried.push(`Set check-in interval to ${newCheckInInterval}h`)
              }

              const escalatorResult = await runEscalator({
                trigger_reason: triggerReason,
                case_data: {
                  ...caseData,
                  drift_score: driftScore,
                  overwhelm_score: overwhelmScore,
                  adherence_rate: adherenceRate,
                  plan: activePlan,
                },
                tasks: caseTasks || [],
                signals: {
                  drift_score: driftScore,
                  overwhelm_score: overwhelmScore,
                  adherence_rate: adherenceRate,
                  sentiment: lastSentiment,
                },
                recent_check_ins: caseCheckIns || [],
                what_ai_tried: whatAiTried,
              })

              const { error: escalationError } = await admin
                .from('escalations')
                .insert({
                  case_id: caseData.id,
                  trigger_reason: escalatorResult.trigger_reason,
                  ai_summary: escalatorResult.summary,
                  ai_recommendations: escalatorResult.recommendations,
                  what_ai_tried: escalatorResult.what_ai_tried,
                  urgency: escalatorResult.urgency,
                })

              if (!escalationError) {
                escalationsCreated++
              }
            } catch (aiErr) {
              console.error(`Escalator AI error for case ${caseData.id}:`, aiErr)
              // If AI fails, create a basic escalation without AI
              const fallbackTrigger = isInactive
                ? `Client inactive for ${Math.floor(daysSinceLastCheckIn!)} days`
                : `Drift score (${driftScore.toFixed(2)}) exceeds threshold`

              await admin.from('escalations').insert({
                case_id: caseData.id,
                trigger_reason: fallbackTrigger,
                ai_summary: `Automated escalation: ${fallbackTrigger}. AI analysis unavailable.`,
                ai_recommendations: [],
                what_ai_tried: [],
                urgency: isInactive ? 'urgent' : 'routine',
              })
              escalationsCreated++
            }
          }
        }

        processed++
      } catch (caseErr) {
        console.error(`Error processing case ${caseData.id}:`, caseErr)
        // Continue processing other cases
        processed++
      }
    }

    return NextResponse.json({
      processed,
      check_ins_triggered: checkInsTriggered,
      escalations_created: escalationsCreated,
    })
  } catch (err) {
    console.error('Daily loop cron error:', err)
    return NextResponse.json({ error: 'Cron job failed' }, { status: 500 })
  }
}
