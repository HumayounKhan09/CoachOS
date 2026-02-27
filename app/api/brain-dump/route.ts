import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { runStructurer } from '@/lib/ai/structurer'

export async function POST(request: NextRequest) {
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
      return NextResponse.json({ error: 'Only clients can submit brain dumps' }, { status: 403 })
    }

    const { text } = await request.json()

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 })
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

    // Load existing active plan + goals
    const { data: activePlan } = await supabase
      .from('plans')
      .select('*')
      .eq('case_id', caseData.id)
      .eq('is_active', true)
      .single()

    // Load existing "now" tasks
    const { data: nowTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('case_id', caseData.id)
      .eq('priority_bucket', 'now')
      .in('status', ['pending', 'active'])
      .order('order_index', { ascending: true })

    // Load latest check-in for recent sentiment
    const { data: latestCheckIn } = await supabase
      .from('check_ins')
      .select('ai_parsed_signals, created_at')
      .eq('case_id', caseData.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const recentSentiment = latestCheckIn?.ai_parsed_signals?.sentiment || 'neutral'

    // Compute days since last brain dump (approximate via plan creation)
    let daysSinceLastBrainDump: number | null = null
    if (activePlan) {
      const planDate = new Date(activePlan.created_at)
      const now = new Date()
      daysSinceLastBrainDump = Math.floor((now.getTime() - planDate.getTime()) / (1000 * 60 * 60 * 24))
    }

    // Build context for the structurer
    const context = {
      existing_goals: activePlan?.goals || [],
      existing_now_tasks: nowTasks || [],
      recent_sentiment: recentSentiment,
      days_since_last_brain_dump: daysSinceLastBrainDump,
    }

    // Call AI Structurer
    const result = await runStructurer(text, context)

    return NextResponse.json({
      candidates: result.candidates,
      overall_sentiment: result.overall_sentiment,
      ambiguity_flags: result.ambiguity_flags,
    })
  } catch (err) {
    console.error('Brain dump error:', err)
    return NextResponse.json({ error: 'Failed to process brain dump' }, { status: 500 })
  }
}
