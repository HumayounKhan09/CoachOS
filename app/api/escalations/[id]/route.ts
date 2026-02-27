import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

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
      return NextResponse.json({ error: 'Only coaches can access escalations' }, { status: 403 })
    }

    const escalationId = params.id

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

    // Verify role is coach
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'coach') {
      return NextResponse.json({ error: 'Only coaches can resolve escalations' }, { status: 403 })
    }

    const escalationId = params.id
    const { coach_action, coach_notes } = await request.json()

    if (!coach_action || !['approved', 'overridden', 'resolved'].includes(coach_action)) {
      return NextResponse.json(
        { error: 'coach_action must be one of: approved, overridden, resolved' },
        { status: 400 }
      )
    }

    // Load the escalation to verify it exists and get case_id
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
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      escalation: updatedEscalation,
    })
  } catch (err) {
    console.error('Escalation PATCH error:', err)
    return NextResponse.json({ error: 'Failed to update escalation' }, { status: 500 })
  }
}
