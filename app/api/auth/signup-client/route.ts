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
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      console.error('signup-client: SUPABASE_SERVICE_ROLE_KEY is not set')
      return NextResponse.json(
        { error: 'Server misconfiguration: service role key not set. Add SUPABASE_SERVICE_ROLE_KEY in Vercel (or .env.local).' },
        { status: 503 }
      )
    }

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
    // Admin client uses SUPABASE_SERVICE_ROLE_KEY and bypasses RLS, so we can insert
    // into clients/cases and update invite_codes without the user being logged in.
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
      console.error('signup-client: createUser failed', { email, message: createError.message })
      return NextResponse.json(
        { error: createError.message || 'Failed to create account' },
        { status: 400 }
      )
    }

    const newUserId = userData.user.id
    const coachId = codeRow.coach_id

    const { error: clientError } = await admin.from('clients').insert({
      id: newUserId,
      coach_id: coachId,
      email,
      full_name,
    })

    if (clientError) {
      console.error('signup-client: clients insert failed', { clientError, coachId, newUserId, email })
      await admin.auth.admin.deleteUser(newUserId)
      const isDuplicate =
        clientError.code === '23505' ||
        (clientError.message && clientError.message.includes('unique') && clientError.message.includes('clients_coach_email'))
      return NextResponse.json(
        {
          error: isDuplicate
            ? 'This email is already registered with your coach. Use a different email or sign in.'
            : `Failed to create client record: ${clientError.message}`,
        },
        { status: isDuplicate ? 409 : 500 }
      )
    }

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

    const { error: caseError } = await admin.from('cases').insert({
      client_id: newUserId,
      coach_id: coachId,
      status: 'active',
      policies: defaultPolicies,
    })

    if (caseError) {
      console.error('signup-client: cases insert failed', { caseError, coachId, newUserId })
      await admin.from('clients').delete().eq('id', newUserId)
      await admin.auth.admin.deleteUser(newUserId)
      return NextResponse.json(
        { error: `Failed to create your case: ${caseError.message}. Please try again or contact your coach.` },
        { status: 500 }
      )
    }

    await admin
      .from('invite_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('id', codeRow.id)

    return NextResponse.json({ success: true, user_id: newUserId })
  } catch (err) {
    console.error('signup-client: unexpected error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
