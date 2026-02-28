import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { runSignalParser } from '@/lib/ai/signal-parser'
import { runPlanner } from '@/lib/ai/planner'
import { runEscalator } from '@/lib/ai/escalator'
import {
  computeAdherenceRate,
  computeDriftScore,
  computeCheckInInterval,
} from '@/lib/signals'
import { z } from 'zod'

const checkInSchema = z.object({
  completed_top_action: z.boolean(),
  blocker: z.string().max(500, 'Blocker text too long').nullable().optional(),
  free_text: z.string().max(5000, 'Free text too long').nullable().optional(),
})

export async function GET() {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', user.id)
      .single()

    if (!client) {
      return NextResponse.json({ error: 'Only clients can access check-ins' }, { status: 403 })
    }

    // Load client's case
    const { data: caseData, error: caseError } = await supabase
      .from('cases')
      .select('*')
      .eq('client_id', user.id)
      .eq('status', 'active')
      .single()

    if (caseError || !caseData) {
      return NextResponse.json({ error: 'No active case found' }, { status: 404 })
    }

    if (!caseData.awaiting_check_in) {
      // Compute next_check_in_at
      const baseTime = caseData.last_check_in_at || caseData.created_at
      let nextCheckInAt: string | null = null
      if (baseTime) {
        const base = new Date(baseTime)
        base.setHours(base.getHours() + (caseData.check_in_interval_hours || 24))
        nextCheckInAt = base.toISOString()
      }

      return NextResponse.json({
        pending: false,
        next_check_in_at: nextCheckInAt,
      })
    }

    // Check-in is pending — load the top "now" task
    const { data: topTask } = await supabase
      .from('tasks')
      .select('id, title')
      .eq('case_id', caseData.id)
      .eq('priority_bucket', 'now')
      .in('status', ['pending', 'active'])
      .order('order_index', { ascending: true })
      .limit(1)
      .single()

    const taskTitle = topTask?.title || 'your top task'

    return NextResponse.json({
      pending: true,
      top_task: topTask || null,
      questions: {
        q1: {
          text: `Did you complete: ${taskTitle}?`,
          type: 'boolean',
        },
        q2: {
          text: 'What got in the way?',
          type: 'single_select',
          options: [
            'Too big',
            'No time',
            'Forgot',
            "Didn't want to",
            'Something came up',
            'Other',
          ],
          conditional_on: { q1: false },
        },
        q3: {
          text: 'Anything else on your mind?',
          type: 'free_text',
          optional: true,
        },
      },
    })
  } catch (err) {
    console.error('Check-in GET error:', err)
    return NextResponse.json({ error: 'Failed to load check-in' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', user.id)
      .single()

    if (!client) {
      return NextResponse.json({ error: 'Only clients can submit check-ins' }, { status: 403 })
    }

    // Validate request body with Zod
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parseResult = checkInSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { completed_top_action, blocker, free_text } = parseResult.data

    // Step 1: Load case + active plan + tasks
    const { data: caseData, error: caseError } = await supabase
      .from('cases')
      .select('*')
      .eq('client_id', user.id)
      .eq('status', 'active')
      .single()

    if (caseError || !caseData) {
      return NextResponse.json({ error: 'No active case found' }, { status: 404 })
    }

    // Prevent double check-in submission
    if (!caseData.awaiting_check_in) {
      return NextResponse.json({ error: 'No check-in is currently pending' }, { status: 409 })
    }

    const policies = caseData.policies as {
      max_now_tasks: number
      escalation_drift_threshold: number
      escalation_failure_threshold: number
      min_check_in_interval_hours: number
      max_check_in_interval_hours: number
    }

    const { data: activePlan } = await supabase
      .from('plans')
      .select('*')
      .eq('case_id', caseData.id)
      .eq('is_active', true)
      .single()

    const { data: allTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('case_id', caseData.id)
      .in('status', ['pending', 'active', 'stuck'])
      .order('order_index', { ascending: true })

    // Step 2: Create check_ins row
    const { data: checkIn, error: checkInError } = await supabase
      .from('check_ins')
      .insert({
        case_id: caseData.id,
        completed_top_action,
        blocker: blocker || null,
        free_text: free_text || null,
      })
      .select()
      .single()

    if (checkInError || !checkIn) {
      return NextResponse.json({ error: 'Failed to create check-in' }, { status: 500 })
    }

    // Step 3: Call AI Signal Parser
    let parsedSignals
    try {
      parsedSignals = await runSignalParser({
        completed_top_action,
        blocker: blocker || null,
        free_text: free_text || null,
      })
    } catch (aiErr) {
      console.error('Signal parser AI error:', aiErr)
      // Fallback signals if AI fails
      parsedSignals = {
        sentiment: 'neutral' as const,
        overwhelm_level: 0.3,
        avoidance_detected: false,
        blocker_category: 'unclear' as const,
        notable_context: null,
      }
    }

    // Save parsed signals on check-in row
    await supabase
      .from('check_ins')
      .update({ ai_parsed_signals: parsedSignals })
      .eq('id', checkIn.id)

    // Step 4: Update case: last_check_in_at, awaiting_check_in
    await supabase
      .from('cases')
      .update({
        last_check_in_at: new Date().toISOString(),
        awaiting_check_in: false,
      })
      .eq('id', caseData.id)

    // Step 5/6: Handle completed_top_action
    const topTask = (allTasks || []).find(
      (t) => t.priority_bucket === 'now' && (t.status === 'pending' || t.status === 'active')
    )

    if (topTask) {
      if (completed_top_action) {
        await supabase
          .from('tasks')
          .update({ status: 'done', completed_at: new Date().toISOString() })
          .eq('id', topTask.id)
      } else {
        await supabase
          .from('tasks')
          .update({ failure_count: (topTask.failure_count || 0) + 1 })
          .eq('id', topTask.id)
      }
    }

    // Reload tasks after update for planner context
    const { data: updatedTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('case_id', caseData.id)
      .in('status', ['pending', 'active', 'stuck'])
      .order('order_index', { ascending: true })

    // Load recent check-ins for context
    const { data: recentCheckIns } = await supabase
      .from('check_ins')
      .select('*')
      .eq('case_id', caseData.id)
      .order('created_at', { ascending: false })
      .limit(5)

    // Step 7: Call AI Planner with updated context
    let plannerResult
    try {
      plannerResult = await runPlanner({
        tasks: updatedTasks || [],
        goals: activePlan?.goals || [],
        recent_check_ins: recentCheckIns || [],
        signals: {
          drift_score: caseData.drift_score,
          overwhelm_score: parsedSignals.overwhelm_level,
          adherence_rate: caseData.adherence_rate,
          sentiment: parsedSignals.sentiment,
          blocker_category: parsedSignals.blocker_category,
        },
        policies: caseData.policies,
        adherence_rate: caseData.adherence_rate,
        overwhelm_score: parsedSignals.overwhelm_level,
        trigger: 'check_in',
      })
    } catch (aiErr) {
      console.error('Planner AI error:', aiErr)
      return NextResponse.json({ error: 'AI planner failed' }, { status: 500 })
    }

    // Step 8: Archive old plan, create new plan
    if (activePlan) {
      await supabase
        .from('plans')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', activePlan.id)
    }

    const newVersion = activePlan ? activePlan.version + 1 : 1
    const { data: newPlan, error: newPlanError } = await supabase
      .from('plans')
      .insert({
        case_id: caseData.id,
        goals: plannerResult.goals,
        weekly_focus: plannerResult.weekly_focus,
        version: newVersion,
        change_summary: plannerResult.change_summary,
        is_active: true,
      })
      .select()
      .single()

    if (newPlanError || !newPlan) {
      return NextResponse.json({ error: 'Failed to create new plan' }, { status: 500 })
    }

    // Apply task_updates from the planner
    for (const taskUpdate of plannerResult.task_updates) {
      if (taskUpdate.task_id) {
        await supabase
          .from('tasks')
          .update({
            title: taskUpdate.title,
            description: taskUpdate.description,
            priority_bucket: taskUpdate.priority_bucket,
            estimated_minutes: taskUpdate.estimated_minutes,
            status: taskUpdate.status,
            plan_id: newPlan.id,
          })
          .eq('id', taskUpdate.task_id)
      } else {
        await supabase
          .from('tasks')
          .insert({
            case_id: caseData.id,
            plan_id: newPlan.id,
            title: taskUpdate.title,
            description: taskUpdate.description,
            status: taskUpdate.status,
            priority_bucket: taskUpdate.priority_bucket,
            estimated_minutes: taskUpdate.estimated_minutes,
            order_index: 0,
          })
      }
    }

    // Step 9: Recompute signals
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const { count: checkInCount } = await supabase
      .from('check_ins')
      .select('*', { count: 'exact', head: true })
      .eq('case_id', caseData.id)
      .gte('created_at', sevenDaysAgo.toISOString())

    const adherenceRate = computeAdherenceRate(
      checkInCount || 0,
      caseData.check_in_interval_hours || 24
    )

    const { data: highFailureTasks } = await supabase
      .from('tasks')
      .select('id')
      .eq('case_id', caseData.id)
      .gte('failure_count', 2)
      .in('status', ['pending', 'active', 'stuck'])

    const hoursSinceLastCheckIn = 0

    const driftScore = computeDriftScore({
      adherenceRate,
      tasksWithHighFailure: highFailureTasks?.length || 0,
      hoursSinceLastCheckIn,
      lastSentiment: parsedSignals.sentiment,
    })

    const overwhelmScore = parsedSignals.overwhelm_level

    // Step 10: Update case with new scores
    const newCheckInInterval = computeCheckInInterval(adherenceRate, driftScore, {
      min_check_in_interval_hours: policies.min_check_in_interval_hours,
      max_check_in_interval_hours: policies.max_check_in_interval_hours,
    })

    await supabase
      .from('cases')
      .update({
        drift_score: driftScore,
        overwhelm_score: overwhelmScore,
        adherence_rate: adherenceRate,
        check_in_interval_hours: newCheckInInterval,
      })
      .eq('id', caseData.id)

    // Step 11: Check escalation triggers
    let escalationCreated = false

    const updatedTopTaskFailureCount = topTask && !completed_top_action
      ? (topTask.failure_count || 0) + 1
      : 0

    const shouldEscalate =
      driftScore > (policies.escalation_drift_threshold || 0.7) ||
      updatedTopTaskFailureCount >= (policies.escalation_failure_threshold || 3) ||
      parsedSignals.sentiment === 'crisis'

    if (shouldEscalate) {
      try {
        const whatAiTried: string[] = []

        if (plannerResult.change_summary) {
          whatAiTried.push(plannerResult.change_summary)
        }
        if (newCheckInInterval < 24) {
          whatAiTried.push(`Increased check-in frequency to every ${newCheckInInterval}h`)
        }

        let triggerReason = ''
        if (parsedSignals.sentiment === 'crisis') {
          triggerReason = 'Crisis language detected in check-in'
        } else if (updatedTopTaskFailureCount >= (policies.escalation_failure_threshold || 3)) {
          triggerReason = `Task '${topTask?.title}' failed ${updatedTopTaskFailureCount} times`
        } else {
          triggerReason = `Drift score (${driftScore.toFixed(2)}) exceeds threshold (${policies.escalation_drift_threshold})`
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
          tasks: updatedTasks || [],
          signals: {
            drift_score: driftScore,
            overwhelm_score: overwhelmScore,
            adherence_rate: adherenceRate,
            sentiment: parsedSignals.sentiment,
          },
          recent_check_ins: recentCheckIns || [],
          what_ai_tried: whatAiTried,
        })

        const { error: escalationError } = await supabase
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
          escalationCreated = true
        }
      } catch (aiErr) {
        console.error('Escalator AI error during check-in:', aiErr)
      }
    }

    // Step 12: Compute next_check_in_at
    const nextCheckInAt = new Date()
    nextCheckInAt.setHours(nextCheckInAt.getHours() + newCheckInInterval)

    const { data: finalTasks } = await supabase
      .from('tasks')
      .select('id, title, estimated_minutes, status, failure_count, priority_bucket')
      .eq('case_id', caseData.id)
      .eq('priority_bucket', 'now')
      .in('status', ['pending', 'active'])
      .order('order_index', { ascending: true })
      .limit(policies.max_now_tasks || 3)

    return NextResponse.json({
      updated_plan: {
        change_summary: plannerResult.change_summary,
        version: newVersion,
      },
      updated_today_tasks: finalTasks || [],
      signals: {
        drift_score: driftScore,
        overwhelm_score: overwhelmScore,
        adherence_rate: adherenceRate,
      },
      escalation_created: escalationCreated,
      next_check_in_at: nextCheckInAt.toISOString(),
      ai_message: plannerResult.client_message,
    })
  } catch (err) {
    console.error('Check-in POST error:', err)
    return NextResponse.json({ error: 'Failed to process check-in' }, { status: 500 })
  }
}
