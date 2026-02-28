import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { runPlanner } from '@/lib/ai/planner'
import { z } from 'zod'

const confirmCandidateSchema = z.object({
  temp_id: z.string().max(100),
  accepted: z.boolean(),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  priority_bucket: z.enum(['now', 'next', 'later']).optional(),
  estimated_minutes: z.number().int().min(1).max(480).nullable().optional(),
  deadline: z.string().max(50).nullable().optional(),
})

const confirmSchema = z.object({
  confirmed_candidates: z.array(confirmCandidateSchema).min(1).max(50),
})

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
      return NextResponse.json({ error: 'Only clients can confirm brain dumps' }, { status: 403 })
    }

    // Validate request body with Zod
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parseResult = confirmSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { confirmed_candidates } = parseResult.data

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

    // Load existing active plan
    const { data: existingPlan } = await supabase
      .from('plans')
      .select('*')
      .eq('case_id', caseData.id)
      .eq('is_active', true)
      .single()

    // Mark old plan as inactive if it exists
    if (existingPlan) {
      await supabase
        .from('plans')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', existingPlan.id)
    }

    // Create a new plan row first (we need the plan_id for tasks)
    const newVersion = existingPlan ? existingPlan.version + 1 : 1
    const { data: newPlan, error: planError } = await supabase
      .from('plans')
      .insert({
        case_id: caseData.id,
        goals: existingPlan?.goals || [],
        weekly_focus: '',
        version: newVersion,
        is_active: true,
      })
      .select()
      .single()

    if (planError || !newPlan) {
      console.error('Failed to create plan:', planError)
      return NextResponse.json({ error: 'Failed to create plan' }, { status: 500 })
    }

    // Create task rows for accepted candidates
    const acceptedCandidates = confirmed_candidates.filter((c) => c.accepted)
    const newTasks = []

    for (let i = 0; i < acceptedCandidates.length; i++) {
      const candidate = acceptedCandidates[i]
      const { data: task, error: taskError } = await supabase
        .from('tasks')
        .insert({
          case_id: caseData.id,
          plan_id: newPlan.id,
          title: candidate.title || 'Untitled task',
          description: candidate.description || null,
          status: 'pending',
          priority_bucket: candidate.priority_bucket || 'next',
          estimated_minutes: candidate.estimated_minutes || null,
          deadline: candidate.deadline || null,
          order_index: i,
        })
        .select()
        .single()

      if (taskError) {
        console.error('Failed to create task:', taskError)
        continue
      }
      newTasks.push(task)
    }

    // Load all existing tasks for this case (including ones from previous plans)
    const { data: allTasks } = await supabase
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

    // Call AI Planner
    let plannerResult
    try {
      plannerResult = await runPlanner({
        tasks: allTasks || [],
        goals: existingPlan?.goals || [],
        recent_check_ins: recentCheckIns || [],
        signals: {
          drift_score: caseData.drift_score,
          overwhelm_score: caseData.overwhelm_score,
          adherence_rate: caseData.adherence_rate,
        },
        policies: caseData.policies,
        adherence_rate: caseData.adherence_rate,
        overwhelm_score: caseData.overwhelm_score,
        trigger: 'brain_dump_confirm',
      })
    } catch (plannerErr) {
      console.error('Planner error:', plannerErr)
      return NextResponse.json({ error: 'AI planning failed' }, { status: 500 })
    }

    // Update plan with planner output
    await supabase
      .from('plans')
      .update({
        goals: plannerResult.goals,
        weekly_focus: plannerResult.weekly_focus,
        change_summary: plannerResult.change_summary,
        updated_at: new Date().toISOString(),
      })
      .eq('id', newPlan.id)

    // Apply task_updates from the planner
    for (const taskUpdate of plannerResult.task_updates) {
      if (taskUpdate.task_id) {
        // Update existing task
        await supabase
          .from('tasks')
          .update({
            title: taskUpdate.title,
            description: taskUpdate.description,
            priority_bucket: taskUpdate.priority_bucket,
            estimated_minutes: taskUpdate.estimated_minutes,
            status: taskUpdate.status,
          })
          .eq('id', taskUpdate.task_id)
      } else {
        // Create new task from planner
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

    // Update check-in interval based on planner recommendation
    const policies = caseData.policies as { min_check_in_interval_hours: number; max_check_in_interval_hours: number }
    const newInterval = Math.max(
      policies.min_check_in_interval_hours,
      Math.min(plannerResult.recommended_check_in_hours, policies.max_check_in_interval_hours)
    )
    await supabase
      .from('cases')
      .update({ check_in_interval_hours: newInterval })
      .eq('id', caseData.id)

    // Load final tasks grouped by bucket
    const { data: finalTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('case_id', caseData.id)
      .eq('plan_id', newPlan.id)
      .in('status', ['pending', 'active'])
      .order('order_index', { ascending: true })

    const groupedTasks = {
      now: (finalTasks || []).filter(t => t.priority_bucket === 'now'),
      next: (finalTasks || []).filter(t => t.priority_bucket === 'next'),
      later: (finalTasks || []).filter(t => t.priority_bucket === 'later'),
    }

    return NextResponse.json({
      plan: {
        id: newPlan.id,
        weekly_focus: plannerResult.weekly_focus,
        version: newVersion,
        change_summary: plannerResult.change_summary,
      },
      tasks: groupedTasks,
    })
  } catch (err) {
    console.error('Brain dump confirm error:', err)
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('active case') || msg.includes('No active')) {
      return NextResponse.json({ error: 'No active case found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to create plan' }, { status: 500 })
  }
}
