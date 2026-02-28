import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const escalationPatchSchema = z.object({
  coach_action: z.enum(['approved', 'overridden', 'resolved']),
  coach_notes: z.string().max(5000, 'Coach notes too long').nullable().optional(),
})

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

    const { data: coach } = await supabase.from('coaches').select('id').eq('id', user.id).single()

    if (!coach) {
      return NextResponse.json({ error: 'Only coaches can access escalations' }, { status: 403 })
    }

    const escalationId = params.id

    // Validate UUID format
    if (!UUID_REGEX.test(escalationId)) {
      return NextResponse.json({ error: 'Invalid escalation ID format' }, { status: 400 })
    }

    // Load the escalation
    const { data: escalation, error: escalationError } = await supabase
      .from('escalations')
      .select('*')
      .eq('id', escalationId)
      .single()

    if (escalationError || !escalation) {
      return NextResponse.json({ error: 'Escalation not found' }, { status: 404 })
    }

    // Verify coach owns the case
    const { data: caseData, error: caseError } = await supabase
      .from('cases')
      .select('*')
      .eq('id', escalation.case_id)
      .eq('coach_id', user.id)
      .single()

    if (caseError || !caseData) {
      return NextResponse.json({ error: 'Escalation not found' }, { status: 404 })
    }

    return NextResponse.json({
      escalation: {
        id: escalation.id,
        trigger_reason: escalation.trigger_reason,
        ai_summary: escalation.ai_summary,
        what_ai_tried: escalation.what_ai_tried,
        ai_recommendations: escalation.ai_recommendations,
        urgency: escalation.urgency,
        coach_action: escalation.coach_action,
        coach_notes: escalation.coach_notes,
        created_at: escalation.created_at,
        resolved_at: escalation.resolved_at,
      },
      case_context: {
        drift_score: caseData.drift_score,
        overwhelm_score: caseData.overwhelm_score,
        adherence_rate: caseData.adherence_rate,
        last_check_in_at: caseData.last_check_in_at,
      },
    })
  } catch (err) {
    console.error('Escalation GET error:', err)
    return NextResponse.json({ error: 'Failed to load escalation' }, { status: 500 })
  }
}

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

    const { data: coach } = await supabase.from('coaches').select('id').eq('id', user.id).single()

    if (!coach) {
      return NextResponse.json({ error: 'Only coaches can resolve escalations' }, { status: 403 })
    }

    const escalationId = params.id

    // Validate UUID format
    if (!UUID_REGEX.test(escalationId)) {
      return NextResponse.json({ error: 'Invalid escalation ID format' }, { status: 400 })
    }

    // Validate request body with Zod
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parseResult = escalationPatchSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { coach_action, coach_notes } = parseResult.data

    // Load the escalation to verify it exists and get case_id
    const { data: escalation, error: escalationError } = await supabase
      .from('escalations')
      .select('*')
      .eq('id', escalationId)
      .single()

    if (escalationError || !escalation) {
      return NextResponse.json({ error: 'Escalation not found' }, { status: 404 })
    }

    // Prevent resolving an already-resolved escalation
    if (escalation.coach_action !== null) {
      return NextResponse.json({ error: 'Escalation has already been resolved' }, { status: 409 })
    }

    // Verify coach owns the case
    const { data: caseData, error: caseError } = await supabase
      .from('cases')
      .select('id')
      .eq('id', escalation.case_id)
      .eq('coach_id', user.id)
      .single()

    if (caseError || !caseData) {
      return NextResponse.json({ error: 'Escalation not found' }, { status: 404 })
    }

    // Update the escalation
    const { data: updatedEscalation, error: updateError } = await supabase
      .from('escalations')
      .update({
        coach_action,
        coach_notes: coach_notes || null,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', escalationId)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ error: 'Failed to update escalation' }, { status: 500 })
    }

    return NextResponse.json({
      escalation: updatedEscalation,
    })
  } catch (err) {
    console.error('Escalation PATCH error:', err)
    return NextResponse.json({ error: 'Failed to update escalation' }, { status: 500 })
  }
}
