import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'coach') {
      return NextResponse.json({ error: 'Only coaches can invite clients' }, { status: 403 })
    }

    const { email, full_name } = await request.json()

    if (!email || !full_name) {
      return NextResponse.json({ error: 'Email and full_name are required' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Check if user already exists
    const { data: existingUsers } = await admin
      .from('profiles')
      .select('id')
      .eq('email', email)

    if (existingUsers && existingUsers.length > 0) {
      return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })
    }

    // Invite the user
    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name,
        role: 'client',
      },
    })

    if (inviteError) {
      return NextResponse.json({ error: inviteError.message }, { status: 500 })
    }

    const newUserId = inviteData.user.id

    // Create a case linking coach and client
    const defaultPolicies = {
      ai_can_reorder_tasks: true,
      ai_can_reduce_scope: true,
      ai_can_change_goals: false,
      ai_can_drop_tasks: false,
      max_now_tasks: 3,
      escalation_drift_threshold: 0.7,
      escalation_failure_threshold: 3,
      min_check_in_interval_hours: 12,
      max_check_in_interval_hours: 72,
    }

    const { data: caseData, error: caseError } = await admin
      .from('cases')
      .insert({
        client_id: newUserId,
        coach_id: user.id,
        status: 'active',
        policies: defaultPolicies,
      })
      .select('id')
      .single()

    if (caseError) {
      return NextResponse.json({ error: caseError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      case_id: caseData.id,
      client_id: newUserId,
    })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
