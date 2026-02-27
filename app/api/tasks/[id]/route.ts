import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { runEscalator } from '@/lib/ai/escalator'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const taskId = params.id
    const body = await request.json()
    const { status, priority_bucket } = body

    if (!status) {
      return NextResponse.json({ error: 'status is required' }, { status: 400 })
    }

    // Load the task (RLS ensures access)
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single()

    if (taskError || !task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Load the case for policies
    const { data: caseData, error: caseError } = await supabase
      .from('cases')
      .select('*')
      .eq('id', task.case_id)
      .single()

    if (caseError || !caseData) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    const policies = caseData.policies as {
      escalation_failure_threshold: number
    }

    // Build update object
    const updateData: Record<string, unknown> = { status }

    if (priority_bucket) {
      updateData.priority_bucket = priority_bucket
    }

    if (status === 'done') {
      updateData.completed_at = new Date().toISOString()
    }

    let newFailureCount = task.failure_count || 0
    if (status === 'stuck') {
      newFailureCount = newFailureCount + 1
      updateData.failure_count = newFailureCount
    }

    // Update the task
    const { data: updatedTask, error: updateError } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', taskId)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // Check if escalation should be created
    let escalationCreated = false

    if (
      status === 'stuck' &&
      newFailureCount >= (policies.escalation_failure_threshold || 3)
    ) {
      try {
        // Load context for escalator
        const { data: allTasks } = await supabase
          .from('tasks')
          .select('*')
          .eq('case_id', caseData.id)
          .order('order_index', { ascending: true })

        const { data: recentCheckIns } = await supabase
          .from('check_ins')
          .select('*')
          .eq('case_id', caseData.id)
          .order('created_at', { ascending: false })
          .limit(5)

        const { data: activePlan } = await supabase
          .from('plans')
          .select('*')
          .eq('case_id', caseData.id)
          .eq('is_active', true)
          .single()

        // Build what_ai_tried from task history
        const whatAiTried: string[] = []
        if (task.estimated_minutes && task.estimated_minutes > 15) {
          whatAiTried.push(`Reduced task from ${task.estimated_minutes}min`)
        }
        if (caseData.check_in_interval_hours < 24) {
          whatAiTried.push(`Increased check-in frequency to ${caseData.check_in_interval_hours}h`)
        }

        const escalatorResult = await runEscalator({
          trigger_reason: `Task '${task.title}' failed ${newFailureCount} times`,
          case_data: {
            ...caseData,
            plan: activePlan,
          },
          tasks: allTasks || [],
          signals: {
            drift_score: caseData.drift_score,
            overwhelm_score: caseData.overwhelm_score,
            adherence_rate: caseData.adherence_rate,
          },
          recent_check_ins: recentCheckIns || [],
          what_ai_tried: whatAiTried,
        })

        // Create escalation row
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
        console.error('Escalator AI error:', aiErr)
        // Escalation creation failed but task update succeeded — don't fail the whole request
      }
    }

    return NextResponse.json({
      task: updatedTask,
      escalation_created: escalationCreated,
    })
  } catch (err) {
    console.error('Task update error:', err)
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 })
  }
}
