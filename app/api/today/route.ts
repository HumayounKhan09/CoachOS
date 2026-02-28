import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify role is client
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'client') {
      return NextResponse.json({ error: 'Only clients can access the today view' }, { status: 403 })
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

    const policies = caseData.policies as { max_now_tasks: number }

    // Load active plan
    const { data: activePlan } = await supabase
      .from('plans')
      .select('*')
      .eq('case_id', caseData.id)
      .eq('is_active', true)
      .single()

    // Load "now" tasks, ordered by order_index, limited to max_now_tasks
    const { data: nowTasks } = await supabase
      .from('tasks')
      .select('id, title, estimated_minutes, status, failure_count')
      .eq('case_id', caseData.id)
      .eq('priority_bucket', 'now')
      .in('status', ['pending', 'active'])
      .order('order_index', { ascending: true })
      .limit(policies.max_now_tasks || 3)

    // Compute next_check_in_at
    let nextCheckInAt: string | null = null
    const baseTime = caseData.last_check_in_at || caseData.created_at
    if (baseTime) {
      const base = new Date(baseTime)
      base.setHours(base.getHours() + (caseData.check_in_interval_hours || 24))
      nextCheckInAt = base.toISOString()
    }

    return NextResponse.json({
      today_tasks: nowTasks || [],
      awaiting_check_in: caseData.awaiting_check_in || false,
      next_check_in_at: nextCheckInAt,
      weekly_focus: activePlan?.weekly_focus || '',
      case_status: caseData.status,
    })
  } catch (err) {
    console.error('Today route error:', err)
    return NextResponse.json({ error: 'Failed to load today view' }, { status: 500 })
  }
}
