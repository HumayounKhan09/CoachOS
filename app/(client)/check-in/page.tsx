'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'

interface CheckInStatus {
  pending: boolean
  next_check_in_at?: string
  top_task?: {
    id: string
    title: string
  }
  questions?: {
    q1: { text: string; type: string }
    q2: { text: string; type: string; options: string[]; conditional_on: { q1: boolean } }
    q3: { text: string; type: string; optional: boolean }
  }
}

interface CheckInResult {
  updated_plan: {
    change_summary: string
    version: number
  }
  updated_today_tasks: Array<{
    id: string
    title: string
    estimated_minutes: number
    status: string
  }>
  signals: {
    drift_score: number
    overwhelm_score: number
    adherence_rate: number
  }
  escalation_created: boolean
  next_check_in_at: string
  ai_message: string
}

const BLOCKER_OPTIONS = [
  'Too big',
  'No time',
  'Forgot',
  "Didn't want to",
  'Something came up',
  'Other',
]

export default function CheckInPage() {
  const router = useRouter()
  const [checkInStatus, setCheckInStatus] = useState<CheckInStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Multi-step form state
  const [step, setStep] = useState(1)
  const [completedTopAction, setCompletedTopAction] = useState<boolean | null>(null)
  const [blocker, setBlocker] = useState<string | null>(null)
  const [freeText, setFreeText] = useState('')
  const [result, setResult] = useState<CheckInResult | null>(null)

  const fetchCheckIn = useCallback(async () => {
    try {
      const res = await fetch('/api/check-in')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to load check-in')
      }
      const data: CheckInStatus = await res.json()
      setCheckInStatus(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCheckIn()
  }, [fetchCheckIn])

  function handleCompleted(value: boolean) {
    setCompletedTopAction(value)
    if (value) {
      // Skip blocker question, go to free text
      setStep(3)
    } else {
      setStep(2)
    }
  }

  function handleBlocker(option: string) {
    setBlocker(option)
    setStep(3)
  }

  async function handleSubmit() {
    if (completedTopAction === null) return
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          completed_top_action: completedTopAction,
          blocker: blocker || undefined,
          free_text: freeText.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to submit check-in')
      }

      const data: CheckInResult = await res.json()
      setResult(data)
      setStep(4)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-surface rounded w-32" />
          <div className="h-4 bg-surface rounded w-48" />
          <div className="h-40 bg-surface rounded" />
        </div>
      </div>
    )
  }

  // Error state
  if (error && !checkInStatus) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-8">
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4">
          <p className="text-danger text-sm">{error}</p>
          <button
            onClick={() => { setError(null); setLoading(true); fetchCheckIn() }}
            className="mt-2 text-sm text-accent hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  // Not pending
  if (checkInStatus && !checkInStatus.pending) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface flex items-center justify-center">
          <svg className="w-8 h-8 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-foreground font-medium mb-2">No check-in right now</p>
        {checkInStatus.next_check_in_at ? (
          <p className="text-muted text-sm mb-6">
            Next one{' '}
            {formatDistanceToNow(new Date(checkInStatus.next_check_in_at), { addSuffix: true })}
          </p>
        ) : (
          <p className="text-muted text-sm mb-6">We&apos;ll let you know when it&apos;s time.</p>
        )}
        <Link
          href="/today"
          className="text-accent text-sm hover:underline"
        >
          Back to Today
        </Link>
      </div>
    )
  }

  if (!checkInStatus) return null

  return (
    <div className="max-w-lg mx-auto px-4 pt-8 pb-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Check-in</h1>
        <p className="text-muted text-sm mt-1">
          {step < 4 ? 'Quick reflection on your progress' : 'Here\'s what changed'}
        </p>
      </div>

      {/* Step indicator */}
      {step < 4 && (
        <div className="flex items-center gap-2 mb-6">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${
                s <= step ? 'bg-accent' : 'bg-border'
              }`}
            />
          ))}
        </div>
      )}

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

      {/* Step 1: Did you complete? */}
      {step === 1 && checkInStatus.top_task && (
        <div>
          <div className="bg-surface border border-border rounded-lg p-5 mb-6">
            <p className="text-muted text-xs uppercase tracking-wide mb-3">Your top task</p>
            <p className="text-foreground font-medium">{checkInStatus.top_task.title}</p>
          </div>

          <p className="text-foreground text-lg font-medium mb-4">Did you complete it?</p>

          <div className="flex gap-3">
            <button
              onClick={() => handleCompleted(true)}
              className="flex-1 py-4 rounded-lg bg-success/10 border border-success/30 text-success font-medium text-lg hover:bg-success/20 transition-colors"
            >
              Yes
            </button>
            <button
              onClick={() => handleCompleted(false)}
              className="flex-1 py-4 rounded-lg bg-danger/10 border border-danger/30 text-danger font-medium text-lg hover:bg-danger/20 transition-colors"
            >
              No
            </button>
          </div>
        </div>
      )}

      {/* Step 2: What got in the way? */}
      {step === 2 && (
        <div>
          <p className="text-foreground text-lg font-medium mb-4">What got in the way?</p>
          <div className="flex flex-wrap gap-2">
            {BLOCKER_OPTIONS.map((option) => (
              <button
                key={option}
                onClick={() => handleBlocker(option)}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  blocker === option
                    ? 'bg-accent text-white'
                    : 'bg-surface border border-border text-foreground hover:border-accent/50'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 3: Anything else? */}
      {step === 3 && (
        <div>
          <p className="text-foreground text-lg font-medium mb-1">Anything else on your mind?</p>
          <p className="text-muted text-sm mb-4">Optional — but it helps us help you.</p>
          <textarea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder="How are you feeling? What's going on?"
            className="w-full h-32 bg-surface border border-border rounded-lg p-4 text-foreground text-sm placeholder:text-muted/60 resize-none focus:outline-none focus:border-accent/50 transition-colors mb-4"
          />
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 py-3 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Submitting...
              </>
            ) : (
              'Submit Check-In'
            )}
          </button>
        </div>
      )}

      {/* Step 4: Results */}
      {step === 4 && result && (
        <div>
          {/* AI message */}
          <div className="bg-accent/10 border border-accent/30 rounded-lg p-4 mb-4">
            <p className="text-foreground text-sm">{result.ai_message}</p>
          </div>

          {/* Plan changes */}
          {result.updated_plan.change_summary && (
            <div className="bg-surface border border-border rounded-lg p-4 mb-4">
              <p className="text-muted text-xs font-medium uppercase tracking-wide mb-1">Plan updated (v{result.updated_plan.version})</p>
              <p className="text-foreground text-sm">{result.updated_plan.change_summary}</p>
            </div>
          )}

          {/* Updated tasks */}
          {result.updated_today_tasks.length > 0 && (
            <div className="mb-4">
              <p className="text-muted text-xs font-medium uppercase tracking-wide mb-2">Your updated tasks</p>
              <div className="space-y-2">
                {result.updated_today_tasks.map((task) => (
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
          )}

          {/* Scores */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-surface border border-border rounded-lg p-3 text-center">
              <p className="text-muted text-xs mb-1">Drift</p>
              <p className={`text-lg font-bold ${
                result.signals.drift_score > 0.5 ? 'text-danger' :
                result.signals.drift_score > 0.3 ? 'text-warning' : 'text-success'
              }`}>
                {Math.round(result.signals.drift_score * 100)}%
              </p>
            </div>
            <div className="bg-surface border border-border rounded-lg p-3 text-center">
              <p className="text-muted text-xs mb-1">Overwhelm</p>
              <p className={`text-lg font-bold ${
                result.signals.overwhelm_score > 0.6 ? 'text-danger' :
                result.signals.overwhelm_score > 0.3 ? 'text-warning' : 'text-success'
              }`}>
                {Math.round(result.signals.overwhelm_score * 100)}%
              </p>
            </div>
            <div className="bg-surface border border-border rounded-lg p-3 text-center">
              <p className="text-muted text-xs mb-1">Adherence</p>
              <p className={`text-lg font-bold ${
                result.signals.adherence_rate > 0.7 ? 'text-success' :
                result.signals.adherence_rate > 0.4 ? 'text-warning' : 'text-danger'
              }`}>
                {Math.round(result.signals.adherence_rate * 100)}%
              </p>
            </div>
          </div>

          {/* Escalation notice */}
          {result.escalation_created && (
            <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 mb-4">
              <p className="text-danger text-sm font-medium">Your coach has been notified</p>
              <p className="text-danger/80 text-xs mt-1">We flagged this for your coach to review. They&apos;ll follow up soon.</p>
            </div>
          )}

          {/* Next check-in */}
          {result.next_check_in_at && (
            <div className="text-center mb-6">
              <p className="text-muted text-xs">
                Next check-in:{' '}
                {formatDistanceToNow(new Date(result.next_check_in_at), { addSuffix: true })}
              </p>
            </div>
          )}

          {/* Go to Today */}
          <button
            onClick={() => router.push('/today')}
            className="w-full flex items-center justify-center gap-2 py-3 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors"
          >
            Go to Today
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
