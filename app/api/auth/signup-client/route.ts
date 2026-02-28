import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const signupClientSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(6).max(100),
  full_name: z.string().min(1).max(200).trim(),
  code: z.string().min(1).max(20).trim(),
})

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parseResult = signupClientSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { email, password, full_name, code } = parseResult.data
    const admin = createAdminClient()

    const { data: codeRow, error: codeError } = await admin
      .from('invite_codes')
      .select('id, coach_id')
      .eq('code', code.toUpperCase())
      .is('used_at', null)
      .single()

    if (codeError || !codeRow) {
      return NextResponse.json({ error: 'Invalid or already used invite code' }, { status: 400 })
    }

    const { data: userData, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    })

    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 400 })
    }

    const newUserId = userData.user.id

    const { error: clientError } = await admin
      .from('clients')
      .insert({
        id: newUserId,
        coach_id: codeRow.coach_id,
        email,
        full_name,
      })

    if (clientError) {
      return NextResponse.json({ error: 'Failed to create client record' }, { status: 500 })
    }

    await admin
      .from('invite_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('id', codeRow.id)

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

    const { error: caseError } = await admin
      .from('cases')
      .insert({
        client_id: newUserId,
        coach_id: codeRow.coach_id,
        status: 'active',
        policies: defaultPolicies,
      })

    if (caseError) {
      return NextResponse.json({ error: 'Failed to create case' }, { status: 500 })
    }

    return NextResponse.json({ success: true, user_id: newUserId })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
