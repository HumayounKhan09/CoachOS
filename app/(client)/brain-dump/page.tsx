'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Candidate {
  temp_id: string
  type: string
  title: string
  description: string | null
  suggested_priority: 'now' | 'next' | 'later'
  estimated_minutes: number | null
  deadline: string | null
  confidence: number
  accepted: boolean
  priority_bucket: 'now' | 'next' | 'later'
}

interface BrainDumpResponse {
  candidates: Omit<Candidate, 'accepted' | 'priority_bucket'>[]
  overall_sentiment: string
  ambiguity_flags: string[]
}

interface PlanResponse {
  plan: {
    id: string
    weekly_focus: string
    version: number
    change_summary: string
  }
  tasks: {
    now: Array<{ id: string; title: string; estimated_minutes: number; status: string }>
    next: Array<{ id: string; title: string; estimated_minutes: number; status: string }>
    later: Array<{ id: string; title: string; estimated_minutes: number; status: string }>
  }
}

const PRIORITY_CYCLE: Array<'now' | 'next' | 'later'> = ['now', 'next', 'later']

const PRIORITY_COLORS: Record<string, string> = {
  now: 'bg-danger/20 text-danger border-danger/30',
  next: 'bg-warning/20 text-warning border-warning/30',
  later: 'bg-muted/20 text-muted border-muted/30',
}

export default function BrainDumpPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<1 | 2 | 3>(1)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [ambiguityFlags, setAmbiguityFlags] = useState<string[]>([])
  const [overallSentiment, setOverallSentiment] = useState<string>('')
  const [planResult, setPlanResult] = useState<PlanResponse | null>(null)

  async function handleProcess() {
    if (!text.trim()) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/brain-dump', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to process brain dump')
      }

      const data: BrainDumpResponse = await res.json()
      setCandidates(
        data.candidates.map((c) => ({
          ...c,
          accepted: true,
          priority_bucket: c.suggested_priority,
        }))
      )
      setAmbiguityFlags(data.ambiguity_flags || [])
      setOverallSentiment(data.overall_sentiment || '')
      setPhase(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  function toggleAccepted(tempId: string) {
    setCandidates((prev) =>
      prev.map((c) =>
        c.temp_id === tempId ? { ...c, accepted: !c.accepted } : c
      )
    )
  }

  function cyclePriority(tempId: string) {
    setCandidates((prev) =>
      prev.map((c) => {
        if (c.temp_id !== tempId) return c
        const currentIdx = PRIORITY_CYCLE.indexOf(c.priority_bucket)
        const nextIdx = (currentIdx + 1) % PRIORITY_CYCLE.length
        return { ...c, priority_bucket: PRIORITY_CYCLE[nextIdx] }
      })
    )
  }

  async function handleConfirm() {
    setLoading(true)
    setError(null)

    try {
      const confirmed_candidates = candidates.map((c) => ({
        temp_id: c.temp_id,
        accepted: c.accepted,
        title: c.title,
        priority_bucket: c.priority_bucket,
        estimated_minutes: c.estimated_minutes,
        deadline: c.deadline,
      }))

      const res = await fetch('/api/brain-dump/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed_candidates }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to confirm plan')
      }

      const data: PlanResponse = await res.json()
      setPlanResult(data)
      setPhase(3)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  function handleAcceptPlan() {
    router.push('/today')
  }

  const acceptedCount = candidates.filter((c) => c.accepted).length

  return (
    <div className="max-w-lg mx-auto px-4 pt-8 pb-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Brain Dump</h1>
        <p className="text-muted text-sm mt-1">
          {phase === 1 && 'Write everything on your mind. We\'ll sort it out.'}
          {phase === 2 && 'Review what we found. Tap to adjust.'}
          {phase === 3 && 'Your plan is ready.'}
        </p>
      </div>

      {/* Phase indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3].map((p) => (
          <div
            key={p}
            className={`h-1 flex-1 rounded-full transition-colors ${
              p <= phase ? 'bg-accent' : 'bg-border'
            }`}
          />
        ))}
      </div>

      {/* Error display */}
      {error && (
        <div className="mb-4 bg-danger/10 border border-danger/30 rounded-lg p-3">
          <p className="text-danger text-sm">{error}</p>
          <button
            onClick={() => setError(null)}
            className="mt-1 text-xs text-muted hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Phase 1: Input */}
      {phase === 1 && (
        <div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="I have a midterm next Tuesday that I haven't started studying for. Also need to call the bank about my account. My room is a mess and I feel overwhelmed..."
            className="w-full h-48 bg-surface border border-border rounded-lg p-4 text-foreground text-sm placeholder:text-muted/60 resize-none focus:outline-none focus:border-accent/50 transition-colors"
          />
          <div className="flex items-center justify-between mt-3">
            <span className="text-muted text-xs">
              {text.length > 0 ? `${text.length} characters` : 'Just write freely'}
            </span>
            <button
              onClick={handleProcess}
              disabled={!text.trim() || loading}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Processing...
                </>
              ) : (
                <>
                  Process
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Phase 2: Review Candidates */}
      {phase === 2 && (
        <div>
          {/* Sentiment indicator */}
          {overallSentiment && overallSentiment !== 'neutral' && (
            <div className={`mb-4 px-3 py-2 rounded-lg text-xs ${
              overallSentiment === 'stressed' || overallSentiment === 'overwhelmed'
                ? 'bg-warning/10 text-warning'
                : overallSentiment === 'crisis'
                ? 'bg-danger/10 text-danger'
                : 'bg-success/10 text-success'
            }`}>
              {overallSentiment === 'stressed' && 'We noticed you seem stressed. We\'ll keep things manageable.'}
              {overallSentiment === 'overwhelmed' && 'Feeling overwhelmed is okay. We\'ll prioritize carefully.'}
              {overallSentiment === 'crisis' && 'It sounds like you\'re going through a lot. Let\'s focus on what matters most.'}
              {overallSentiment === 'positive' && 'You\'re in a good place. Let\'s make the most of it.'}
            </div>
          )}

          {/* Ambiguity flags */}
          {ambiguityFlags.length > 0 && (
            <div className="mb-4 bg-warning/10 border border-warning/30 rounded-lg p-3">
              <p className="text-warning text-xs font-medium mb-1">Heads up</p>
              {ambiguityFlags.map((flag, i) => (
                <p key={i} className="text-warning/80 text-xs">- {flag}</p>
              ))}
            </div>
          )}

          {/* Candidate cards */}
          <div className="space-y-3 mb-6">
            {candidates.map((candidate) => (
              <div
                key={candidate.temp_id}
                className={`bg-surface border rounded-lg p-4 transition-all ${
                  candidate.accepted
                    ? candidate.confidence < 0.7
                      ? 'border-warning/50'
                      : 'border-border'
                    : 'border-border opacity-50'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 mr-3">
                    <h3 className={`font-medium text-sm ${
                      candidate.accepted ? 'text-foreground' : 'text-muted line-through'
                    }`}>
                      {candidate.title}
                    </h3>
                    {candidate.description && (
                      <p className="text-muted text-xs mt-1">{candidate.description}</p>
                    )}
                  </div>

                  {/* Accept/Reject toggle */}
                  <button
                    onClick={() => toggleAccepted(candidate.temp_id)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                      candidate.accepted
                        ? 'bg-success/20 text-success'
                        : 'bg-danger/20 text-danger'
                    }`}
                  >
                    {candidate.accepted ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Priority pill - tappable */}
                  <button
                    onClick={() => cyclePriority(candidate.temp_id)}
                    className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                      PRIORITY_COLORS[candidate.priority_bucket]
                    }`}
                  >
                    {candidate.priority_bucket}
                  </button>

                  {/* Estimated time */}
                  {candidate.estimated_minutes && (
                    <span className="text-muted text-xs flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {candidate.estimated_minutes} min
                    </span>
                  )}

                  {/* Deadline */}
                  {candidate.deadline && (
                    <span className="text-muted text-xs flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {candidate.deadline}
                    </span>
                  )}

                  {/* Confidence */}
                  <span className={`text-xs ${
                    candidate.confidence >= 0.7 ? 'text-muted' : 'text-warning'
                  }`}>
                    {Math.round(candidate.confidence * 100)}% sure
                  </span>
                </div>

                {/* Low confidence warning */}
                {candidate.confidence < 0.7 && (
                  <p className="text-warning text-xs mt-2 italic">
                    AI isn&apos;t sure about this one
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Confirm button */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => { setPhase(1); setCandidates([]); setError(null) }}
              className="text-muted text-sm hover:text-foreground transition-colors"
            >
              Start over
            </button>
            <button
              onClick={handleConfirm}
              disabled={acceptedCount === 0 || loading}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Building plan...
                </>
              ) : (
                <>
                  Confirm &amp; Build Plan ({acceptedCount})
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Phase 3: Plan Preview */}
      {phase === 3 && planResult && (
        <div>
          {/* Weekly focus */}
          <div className="bg-accent/10 border border-accent/30 rounded-lg p-4 mb-4">
            <p className="text-accent text-xs font-medium uppercase tracking-wide mb-1">Weekly Focus</p>
            <p className="text-foreground text-sm">{planResult.plan.weekly_focus}</p>
          </div>

          {/* Change summary */}
          {planResult.plan.change_summary && (
            <div className="bg-surface border border-border rounded-lg p-4 mb-4">
              <p className="text-muted text-xs font-medium uppercase tracking-wide mb-1">What changed</p>
              <p className="text-foreground text-sm">{planResult.plan.change_summary}</p>
            </div>
          )}

          {/* Tasks grouped by bucket */}
          {(['now', 'next', 'later'] as const).map((bucket) => {
            const tasks = planResult.tasks[bucket]
            if (!tasks || tasks.length === 0) return null
            return (
              <div key={bucket} className="mb-4">
                <h3 className="text-xs font-medium uppercase tracking-wide mb-2 flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    bucket === 'now' ? 'bg-danger' : bucket === 'next' ? 'bg-warning' : 'bg-muted'
                  }`} />
                  <span className="text-muted">{bucket}</span>
                  <span className="text-muted/60">({tasks.length})</span>
                </h3>
                <div className="space-y-2">
                  {tasks.map((task) => (
                    <div key={task.id} className="bg-surface border border-border rounded-lg px-4 py-3 flex items-center justify-between">
                      <span className="text-foreground text-sm">{task.title}</span>
                      {task.estimated_minutes > 0 && (
                        <span className="text-muted text-xs flex-shrink-0 ml-2">
                          {task.estimated_minutes} min
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {/* Accept plan button */}
          <div className="mt-6 flex justify-center">
            <button
              onClick={handleAcceptPlan}
              className="flex items-center gap-2 px-8 py-3 bg-success text-white rounded-lg text-sm font-medium hover:bg-success/90 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Accept Plan
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
