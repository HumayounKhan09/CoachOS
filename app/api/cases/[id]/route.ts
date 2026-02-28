import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify role is coach
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'coach') {
      return NextResponse.json({ error: 'Only coaches can access case details' }, { status: 403 })
    }

    const caseId = params.id

    // Validate UUID format
    if (!UUID_REGEX.test(caseId)) {
      return NextResponse.json({ error: 'Invalid case ID format' }, { status: 400 })
    }

    // Load the case (RLS ensures coach can only see their own cases)
    const { data: caseData, error: caseError } = await supabase
      .from('cases')
      .select('*')
      .eq('id', caseId)
      .eq('coach_id', user.id)
      .single()

    if (caseError || !caseData) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    // Load client profile
    const { data: clientProfile } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('id', caseData.client_id)
      .single()

    // Load active plan
    const { data: activePlan } = await supabase
      .from('plans')
      .select('*')
      .eq('case_id', caseId)
      .eq('is_active', true)
      .single()

    // Load all tasks grouped by bucket
    const { data: allTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('case_id', caseId)
      .order('order_index', { ascending: true })

    const tasks = {
      now: (allTasks || []).filter(
        (t) => t.priority_bucket === 'now' && t.status !== 'done' && t.status !== 'dropped'
      ),
      next: (allTasks || []).filter(
        (t) => t.priority_bucket === 'next' && t.status !== 'done' && t.status !== 'dropped'
      ),
      later: (allTasks || []).filter(
        (t) => t.priority_bucket === 'later' && t.status !== 'done' && t.status !== 'dropped'
      ),
      done: (allTasks || []).filter((t) => t.status === 'done'),
    }

    // Load recent check-ins (last 7)
    const { data: recentCheckIns } = await supabase
      .from('check_ins')
      .select('*')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false })
      .limit(7)

    // Build signal history from recent check-ins (last 14 days)
    const fourteenDaysAgo = new Date()
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

    const { data: signalCheckIns } = await supabase
      .from('check_ins')
      .select('ai_parsed_signals, created_at')
      .eq('case_id', caseId)
      .gte('created_at', fourteenDaysAgo.toISOString())
      .order('created_at', { ascending: true })

    const signalHistory = (signalCheckIns || []).map((ci) => {
      const signals = ci.ai_parsed_signals as {
        sentiment?: string
        overwhelm_level?: number
      } | null
      return {
        type: 'drift',
        score: signals?.overwhelm_level || 0,
        sentiment: signals?.sentiment || 'neutral',
        computed_at: ci.created_at,
      }
    })

    // Load escalations
    const { data: escalations } = await supabase
      .from('escalations')
      .select('*')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false })

    return NextResponse.json({
      case: {
        id: caseData.id,
        status: caseData.status,
        drift_score: caseData.drift_score,
        overwhelm_score: caseData.overwhelm_score,
        adherence_rate: caseData.adherence_rate,
        check_in_interval_hours: caseData.check_in_interval_hours,
        policies: caseData.policies,
      },
      client: {
        id: clientProfile?.id || caseData.client_id,
        full_name: clientProfile?.full_name || 'Unknown',
        email: clientProfile?.email || '',
      },
      plan: activePlan
        ? {
            id: activePlan.id,
            goals: activePlan.goals,
            weekly_focus: activePlan.weekly_focus,
            version: activePlan.version,
            change_summary: activePlan.change_summary,
          }
        : null,
      tasks,
      recent_check_ins: recentCheckIns || [],
      signal_history: signalHistory,
      escalations: (escalations || []).map((e) => ({
        id: e.id,
        trigger_reason: e.trigger_reason,
        ai_summary: e.ai_summary,
        ai_recommendations: e.ai_recommendations,
        what_ai_tried: e.what_ai_tried,
        urgency: e.urgency,
        coach_action: e.coach_action,
        coach_notes: e.coach_notes,
        created_at: e.created_at,
        resolved_at: e.resolved_at,
      })),
    })
  } catch (err) {
    console.error('Case detail error:', err)
    return NextResponse.json({ error: 'Failed to load case details' }, { status: 500 })
  }
}
