import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { formatDistanceToNow } from 'date-fns'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
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
      return NextResponse.json({ error: 'Only coaches can access cases' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const VALID_SORTS = ['drift', 'adherence', 'last_check_in', 'name'] as const
    const VALID_FILTERS = ['all', 'needs_review', 'drifting', 'on_track', 'inactive'] as const

    const rawSort = searchParams.get('sort') || 'drift'
    const rawFilter = searchParams.get('filter') || 'all'

    const sort = (VALID_SORTS as readonly string[]).includes(rawSort) ? rawSort : 'drift'
    const filter = (VALID_FILTERS as readonly string[]).includes(rawFilter) ? rawFilter : 'all'

    // Load all cases where coach_id = auth.uid()
    const { data: cases, error: casesError } = await supabase
      .from('cases')
      .select('*')
      .eq('coach_id', user.id)

    if (casesError) {
      return NextResponse.json({ error: casesError.message }, { status: 500 })
    }

    if (!cases || cases.length === 0) {
      return NextResponse.json({
        cases: [],
        summary: { total: 0, needs_review: 0, drifting: 0, on_track: 0, inactive: 0 },
      })
    }

    // Get client profiles for names
    const clientIds = cases.map((c) => c.client_id)
    const { data: clientProfiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', clientIds)

    const profileMap = new Map(
      (clientProfiles || []).map((p) => [p.id, p])
    )

    // Get unresolved escalations per case
    const caseIds = cases.map((c) => c.id)
    const { data: unresolvedEscalations } = await supabase
      .from('escalations')
      .select('id, case_id')
      .in('case_id', caseIds)
      .is('coach_action', null)

    const escalationCountMap = new Map<string, number>()
    for (const esc of unresolvedEscalations || []) {
      escalationCountMap.set(
        esc.case_id,
        (escalationCountMap.get(esc.case_id) || 0) + 1
      )
    }

    // Load active plans for weekly focus
    const { data: activePlans } = await supabase
      .from('plans')
      .select('case_id, weekly_focus')
      .in('case_id', caseIds)
      .eq('is_active', true)

    const planMap = new Map(
      (activePlans || []).map((p) => [p.case_id, p.weekly_focus])
    )

    // Compute computed_status for each case
    const now = new Date()

    const enrichedCases = cases.map((c) => {
      const clientProfile = profileMap.get(c.client_id)
      const pendingEscalations = escalationCountMap.get(c.id) || 0

      // Compute status
      let computedStatus: string
      const hoursSinceCheckIn = c.last_check_in_at
        ? (now.getTime() - new Date(c.last_check_in_at).getTime()) / (1000 * 60 * 60)
        : null

      if (pendingEscalations > 0) {
        computedStatus = 'needs_review'
      } else if (hoursSinceCheckIn !== null && hoursSinceCheckIn >= 72) {
        computedStatus = 'inactive'
      } else if (c.drift_score > 0.5) {
        computedStatus = 'drifting'
      } else {
        computedStatus = 'on_track'
      }

      // Compute relative time
      let lastCheckInRelative: string | null = null
      if (c.last_check_in_at) {
        lastCheckInRelative = formatDistanceToNow(new Date(c.last_check_in_at), {
          addSuffix: true,
        })
      }

      return {
        id: c.id,
        client_name: clientProfile?.full_name || 'Unknown',
        client_email: clientProfile?.email || '',
        computed_status: computedStatus,
        drift_score: c.drift_score,
        adherence_rate: c.adherence_rate,
        overwhelm_score: c.overwhelm_score,
        last_check_in_at: c.last_check_in_at,
        last_check_in_relative: lastCheckInRelative,
        pending_escalations: pendingEscalations,
        weekly_focus: planMap.get(c.id) || '',
      }
    })

    // Apply filter
    let filteredCases = enrichedCases
    if (filter !== 'all') {
      filteredCases = enrichedCases.filter((c) => c.computed_status === filter)
    }

    // Apply sort
    filteredCases.sort((a, b) => {
      switch (sort) {
        case 'drift':
          return b.drift_score - a.drift_score
        case 'adherence':
          return a.adherence_rate - b.adherence_rate
        case 'last_check_in':
          if (!a.last_check_in_at) return 1
          if (!b.last_check_in_at) return -1
          return new Date(a.last_check_in_at).getTime() - new Date(b.last_check_in_at).getTime()
        case 'name':
          return a.client_name.localeCompare(b.client_name)
        default:
          return b.drift_score - a.drift_score
      }
    })

    // Compute summary counts
    const summary = {
      total: enrichedCases.length,
      needs_review: enrichedCases.filter((c) => c.computed_status === 'needs_review').length,
      drifting: enrichedCases.filter((c) => c.computed_status === 'drifting').length,
      on_track: enrichedCases.filter((c) => c.computed_status === 'on_track').length,
      inactive: enrichedCases.filter((c) => c.computed_status === 'inactive').length,
    }

    return NextResponse.json({
      cases: filteredCases,
      summary,
    })
  } catch (err) {
    console.error('Cases route error:', err)
    return NextResponse.json({ error: 'Failed to load cases' }, { status: 500 })
  }
}
