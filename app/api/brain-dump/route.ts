import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { runStructurer } from '@/lib/ai/structurer'
import { z } from 'zod'

const brainDumpSchema = z.object({
  text: z.string().min(1, 'Text is required').max(10000, 'Text exceeds maximum length of 10,000 characters').trim(),
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
      .maybeSingle()

    if (!client) {
      return NextResponse.json({ error: 'Only clients can submit brain dumps' }, { status: 403 })
    }

    // Validate request body with Zod
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parseResult = brainDumpSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { text } = parseResult.data

    // Load client's case
    const { data: caseData, error: caseError } = await supabase
      .from('cases')
      .select('*')
      .eq('client_id', user.id)
      .eq('status', 'active')
      .maybeSingle()

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
      .maybeSingle()

    const recentSentiment = (latestCheckIn?.ai_parsed_signals as { sentiment?: string } | null)?.sentiment || 'neutral'

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
    const message = err instanceof Error ? err.message : String(err)
    console.error('Brain dump error:', { message, stack: err instanceof Error ? err.stack : undefined })
    const isAuthError =
      /api key|invalid key|unauthorized|authentication|401|403/i.test(message) ||
      (message && message.includes('AI_GATEWAY'))
    const errorMessage =
      isAuthError
        ? 'AI service is not configured. Please set AI_GATEWAY_API_KEY (or provider API key) in your environment.'
        : 'AI processing failed'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
