'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatDistanceToNow, format } from 'date-fns'

interface Goal {
  id: string
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
}

interface Task {
  id: string
  title: string
  description: string | null
  status: string
  priority_bucket: string
  estimated_minutes: number | null
  failure_count: number
  order_index: number
  deadline: string | null
  completed_at: string | null
}

interface CheckIn {
  id: string
  completed_top_action: boolean
  blocker: string | null
  free_text: string | null
  ai_parsed_signals: {
    sentiment?: string
    overwhelm_level?: number
    avoidance_detected?: boolean
    blocker_category?: string
    notable_context?: string | null
  }
  created_at: string
}

interface Escalation {
  id: string
  trigger_reason: string
  ai_summary: string
  ai_recommendations: Array<{ action: string; rationale: string }>
  what_ai_tried: string[]
  urgency: 'routine' | 'urgent' | 'critical'
  coach_action: string | null
  coach_notes: string | null
  created_at: string
  resolved_at: string | null
}

interface SignalHistoryEntry {
  type: string
  score: number
  computed_at: string
}

interface CaseDetailResponse {
  case: {
    id: string
    status: string
    drift_score: number
    overwhelm_score: number
    adherence_rate: number
    check_in_interval_hours: number
    last_check_in_at: string | null
    policies: Record<string, unknown>
  }
  client: {
    id: string
    full_name: string
    email: string
  }
  plan: {
    id: string
    goals: Goal[]
    weekly_focus: string
    version: number
    change_summary: string
  } | null
  tasks: {
    now: Task[]
    next: Task[]
    later: Task[]
    done: Task[]
  }
  recent_check_ins: CheckIn[]
  signal_history: SignalHistoryEntry[]
  escalations: Escalation[]
}

const URGENCY_COLORS: Record<string, string> = {
  routine: 'bg-muted/20 text-muted border-muted/30',
  urgent: 'bg-warning/20 text-warning border-warning/30',
  critical: 'bg-danger/20 text-danger border-danger/30',
}

const PRIORITY_COLORS: Record<string, string> = {
  high: 'text-danger',
  medium: 'text-warning',
  low: 'text-muted',
}

export default function CaseDetailPage() {
  const params = useParams()
  const router = useRouter()
  const caseId = params.id as string

  const [data, setData] = useState<CaseDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Escalation action state
  const [escalationNotes, setEscalationNotes] = useState<Record<string, string>>({})
  const [escalationActionLoading, setEscalationActionLoading] = useState<string | null>(null)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)

  const fetchCase = useCallback(async () => {
    try {
      const res = await fetch(`/api/cases/${caseId}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to load case')
      }
      const json: CaseDetailResponse = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [caseId])

  useEffect(() => {
    fetchCase()
  }, [fetchCase])

  useEffect(() => {
    if (actionFeedback) {
      const timer = setTimeout(() => setActionFeedback(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [actionFeedback])

  async function handleEscalationAction(
    escalationId: string,
    action: 'approved' | 'overridden' | 'resolved'
  ) {
    setEscalationActionLoading(escalationId)
    try {
      const res = await fetch(`/api/escalations/${escalationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coach_action: action,
          coach_notes: escalationNotes[escalationId] || undefined,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to update escalation')
      }

      setActionFeedback(
        action === 'approved'
          ? 'AI recommendations approved'
          : action === 'overridden'
          ? 'Escalation overridden'
          : 'Escalation resolved'
      )

      // Refresh data
      fetchCase()
    } catch (err) {
      setActionFeedback(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setEscalationActionLoading(null)
    }
  }

  function getScoreColor(score: number, isInverse: boolean = false) {
    if (isInverse) {
      if (score > 0.7) return 'text-success'
      if (score > 0.4) return 'text-warning'
      return 'text-danger'
    }
    if (score > 0.5) return 'text-danger'
    if (score > 0.3) return 'text-warning'
    return 'text-success'
  }

  function getScoreBgColor(score: number, isInverse: boolean = false) {
    if (isInverse) {
      if (score > 0.7) return 'border-success/30'
      if (score > 0.4) return 'border-warning/30'
      return 'border-danger/30'
    }
    if (score > 0.5) return 'border-danger/30'
    if (score > 0.3) return 'border-warning/30'
    return 'border-success/30'
  }

  // Loading state
  if (loading) {
    return (
      <div className="p-6 max-w-5xl">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-surface rounded w-48" />
          <div className="h-4 bg-surface rounded w-32" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-surface rounded-lg" />
            ))}
          </div>
          <div className="h-48 bg-surface rounded-lg" />
          <div className="h-64 bg-surface rounded-lg" />
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="p-6 max-w-5xl">
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4">
          <p className="text-danger text-sm">{error}</p>
          <button
            onClick={() => { setError(null); setLoading(true); fetchCase() }}
            className="mt-2 text-sm text-accent hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!data) return null

  const unresolvedEscalations = data.escalations.filter((e) => !e.coach_action)
  const resolvedEscalations = data.escalations.filter((e) => e.coach_action)

  return (
    <div className="p-6 max-w-5xl">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-muted hover:text-foreground transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-foreground">{data.client.full_name}</h1>
            <p className="text-muted text-sm">{data.client.email}</p>
          </div>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
            data.case.status === 'active'
              ? 'bg-success/20 text-success'
              : data.case.status === 'paused'
              ? 'bg-warning/20 text-warning'
              : 'bg-muted/20 text-muted'
          }`}>
            {data.case.status}
          </span>
        </div>
      </div>

      {/* Score cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className={`bg-surface border rounded-lg p-4 ${getScoreBgColor(data.case.drift_score)}`}>
          <p className="text-muted text-xs mb-1">Drift Score</p>
          <p className={`text-2xl font-bold ${getScoreColor(data.case.drift_score)}`}>
            {Math.round(data.case.drift_score * 100)}%
          </p>
        </div>
        <div className={`bg-surface border rounded-lg p-4 ${getScoreBgColor(data.case.adherence_rate, true)}`}>
          <p className="text-muted text-xs mb-1">Adherence</p>
          <p className={`text-2xl font-bold ${getScoreColor(data.case.adherence_rate, true)}`}>
            {Math.round(data.case.adherence_rate * 100)}%
          </p>
        </div>
        <div className={`bg-surface border rounded-lg p-4 ${getScoreBgColor(data.case.overwhelm_score)}`}>
          <p className="text-muted text-xs mb-1">Overwhelm</p>
          <p className={`text-2xl font-bold ${getScoreColor(data.case.overwhelm_score)}`}>
            {Math.round(data.case.overwhelm_score * 100)}%
          </p>
        </div>
        <div className="bg-surface border border-border rounded-lg p-4">
          <p className="text-muted text-xs mb-1">Last Check-in</p>
          <p className="text-foreground text-sm font-medium">
            {data.case.last_check_in_at
              ? formatDistanceToNow(new Date(data.case.last_check_in_at), { addSuffix: true })
              : 'Never'}
          </p>
          <p className="text-muted text-xs mt-0.5">
            Interval: {data.case.check_in_interval_hours}h
          </p>
        </div>
      </div>

      {/* Unresolved Escalations - shown prominently */}
      {unresolvedEscalations.length > 0 && (
        <div className="mb-6">
          {unresolvedEscalations.map((esc) => (
            <div
              key={esc.id}
              className={`border-2 rounded-xl p-5 mb-4 ${
                esc.urgency === 'critical'
                  ? 'border-danger bg-danger/5'
                  : esc.urgency === 'urgent'
                  ? 'border-warning bg-warning/5'
                  : 'border-muted/50 bg-surface'
              }`}
            >
              {/* Escalation header */}
              <div className="flex items-center gap-3 mb-4">
                <svg className="w-5 h-5 text-danger flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <h2 className="text-foreground font-bold text-lg">Escalation</h2>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                  URGENCY_COLORS[esc.urgency]
                }`}>
                  {esc.urgency}
                </span>
                <span className="text-muted text-xs ml-auto">
                  {formatDistanceToNow(new Date(esc.created_at), { addSuffix: true })}
                </span>
              </div>

              {/* Trigger reason */}
              <div className="mb-4">
                <p className="text-muted text-xs font-medium uppercase tracking-wide mb-1">Trigger</p>
                <p className="text-foreground text-sm">{esc.trigger_reason}</p>
              </div>

              {/* AI Summary */}
              <div className="mb-4">
                <p className="text-muted text-xs font-medium uppercase tracking-wide mb-1">AI Summary</p>
                <p className="text-foreground text-sm leading-relaxed">{esc.ai_summary}</p>
              </div>

              {/* What AI tried */}
              {esc.what_ai_tried && esc.what_ai_tried.length > 0 && (
                <div className="mb-4">
                  <p className="text-muted text-xs font-medium uppercase tracking-wide mb-2">What AI tried</p>
                  <ul className="space-y-1">
                    {esc.what_ai_tried.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                        <span className="text-muted mt-0.5">-</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* AI Recommendations */}
              {esc.ai_recommendations && esc.ai_recommendations.length > 0 && (
                <div className="mb-4">
                  <p className="text-muted text-xs font-medium uppercase tracking-wide mb-2">AI Recommends</p>
                  <div className="space-y-2">
                    {esc.ai_recommendations.map((rec, i) => (
                      <div key={i} className="bg-background/50 border border-border rounded-lg p-3">
                        <p className="text-foreground text-sm font-medium">
                          {i + 1}. {rec.action}
                        </p>
                        <p className="text-muted text-xs mt-1">{rec.rationale}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Case context scores */}
              <div className="grid grid-cols-3 gap-3 mb-4 p-3 bg-background/50 rounded-lg">
                <div className="text-center">
                  <p className="text-muted text-xs">Drift</p>
                  <p className={`text-sm font-bold ${getScoreColor(data.case.drift_score)}`}>
                    {Math.round(data.case.drift_score * 100)}%
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-muted text-xs">Overwhelm</p>
                  <p className={`text-sm font-bold ${getScoreColor(data.case.overwhelm_score)}`}>
                    {Math.round(data.case.overwhelm_score * 100)}%
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-muted text-xs">Adherence</p>
                  <p className={`text-sm font-bold ${getScoreColor(data.case.adherence_rate, true)}`}>
                    {Math.round(data.case.adherence_rate * 100)}%
                  </p>
                </div>
              </div>

              {/* Coach notes */}
              <div className="mb-4">
                <label className="block text-muted text-xs font-medium uppercase tracking-wide mb-1">
                  Coach notes
                </label>
                <textarea
                  value={escalationNotes[esc.id] || ''}
                  onChange={(e) =>
                    setEscalationNotes((prev) => ({ ...prev, [esc.id]: e.target.value }))
                  }
                  placeholder="Add your notes here (optional)..."
                  className="w-full h-20 bg-background border border-border rounded-lg p-3 text-foreground text-sm placeholder:text-muted/60 resize-none focus:outline-none focus:border-accent/50 transition-colors"
                />
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => handleEscalationAction(esc.id, 'approved')}
                  disabled={escalationActionLoading === esc.id}
                  className="flex-1 py-2.5 rounded-lg bg-success/10 border border-success/30 text-success text-sm font-medium hover:bg-success/20 disabled:opacity-40 transition-colors"
                >
                  {escalationActionLoading === esc.id ? 'Processing...' : 'Approve AI Rec'}
                </button>
                <button
                  onClick={() => handleEscalationAction(esc.id, 'overridden')}
                  disabled={escalationActionLoading === esc.id}
                  className="flex-1 py-2.5 rounded-lg bg-warning/10 border border-warning/30 text-warning text-sm font-medium hover:bg-warning/20 disabled:opacity-40 transition-colors"
                >
                  Override
                </button>
                <button
                  onClick={() => handleEscalationAction(esc.id, 'resolved')}
                  disabled={escalationActionLoading === esc.id}
                  className="flex-1 py-2.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium hover:bg-accent/20 disabled:opacity-40 transition-colors"
                >
                  Mark Resolved
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Plan section */}
      {data.plan && (
        <div className="bg-surface border border-border rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-foreground font-bold">Plan</h2>
            <span className="text-muted text-xs">v{data.plan.version}</span>
          </div>

          {/* Weekly focus */}
          {data.plan.weekly_focus && (
            <div className="bg-accent/10 border border-accent/30 rounded-lg p-3 mb-4">
              <p className="text-accent text-xs font-medium uppercase tracking-wide mb-0.5">Weekly Focus</p>
              <p className="text-foreground text-sm">{data.plan.weekly_focus}</p>
            </div>
          )}

          {/* Change summary */}
          {data.plan.change_summary && (
            <p className="text-muted text-xs italic mb-4">{data.plan.change_summary}</p>
          )}

          {/* Goals */}
          {data.plan.goals && data.plan.goals.length > 0 && (
            <div className="mb-4">
              <p className="text-muted text-xs font-medium uppercase tracking-wide mb-2">Goals</p>
              <div className="space-y-1.5">
                {data.plan.goals.map((goal) => (
                  <div key={goal.id} className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      goal.priority === 'high' ? 'bg-danger' :
                      goal.priority === 'medium' ? 'bg-warning' : 'bg-muted'
                    }`} />
                    <span className="text-foreground text-sm">{goal.title}</span>
                    <span className={`text-xs ${PRIORITY_COLORS[goal.priority]}`}>
                      ({goal.priority})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tasks by bucket */}
          {(['now', 'next', 'later', 'done'] as const).map((bucket) => {
            const tasks = data.tasks[bucket]
            if (!tasks || tasks.length === 0) return null

            return (
              <div key={bucket} className="mb-3 last:mb-0">
                <p className="text-muted text-xs font-medium uppercase tracking-wide mb-1.5 flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    bucket === 'now' ? 'bg-danger' :
                    bucket === 'next' ? 'bg-warning' :
                    bucket === 'later' ? 'bg-muted' : 'bg-success'
                  }`} />
                  {bucket} ({tasks.length})
                </p>
                <div className="space-y-1">
                  {tasks.map((task) => (
                    <div key={task.id} className="flex items-center justify-between px-3 py-2 bg-background/50 rounded-lg">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-sm ${
                          task.status === 'done' ? 'text-muted line-through' :
                          task.status === 'stuck' ? 'text-danger' : 'text-foreground'
                        }`}>
                          {task.title}
                        </span>
                        {task.failure_count > 0 && (
                          <span className="text-warning text-xs flex-shrink-0">
                            ({task.failure_count}x failed)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        {task.estimated_minutes && (
                          <span className="text-muted text-xs">{task.estimated_minutes}m</span>
                        )}
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          task.status === 'done' ? 'bg-success/20 text-success' :
                          task.status === 'stuck' ? 'bg-danger/20 text-danger' :
                          task.status === 'active' ? 'bg-accent/20 text-accent' :
                          'bg-muted/20 text-muted'
                        }`}>
                          {task.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* No plan state */}
      {!data.plan && (
        <div className="bg-surface border border-border rounded-xl p-5 mb-6 text-center">
          <p className="text-muted text-sm">No plan created yet. Waiting for client&apos;s first brain dump.</p>
        </div>
      )}

      {/* Recent check-ins */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-6">
        <h2 className="text-foreground font-bold mb-4">Recent Check-ins</h2>

        {data.recent_check_ins.length === 0 ? (
          <p className="text-muted text-sm">No check-ins yet.</p>
        ) : (
          <div className="space-y-3">
            {data.recent_check_ins.map((checkIn) => (
              <div key={checkIn.id} className="bg-background/50 border border-border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      checkIn.completed_top_action ? 'bg-success' : 'bg-danger'
                    }`} />
                    <span className="text-foreground text-sm font-medium">
                      {checkIn.completed_top_action ? 'Completed' : 'Not completed'}
                    </span>
                    {checkIn.blocker && (
                      <span className="text-warning text-xs bg-warning/10 px-2 py-0.5 rounded-full">
                        {checkIn.blocker}
                      </span>
                    )}
                  </div>
                  <span className="text-muted text-xs">
                    {formatDistanceToNow(new Date(checkIn.created_at), { addSuffix: true })}
                  </span>
                </div>
                {checkIn.free_text && (
                  <p className="text-foreground/80 text-sm mb-2">&ldquo;{checkIn.free_text}&rdquo;</p>
                )}
                {checkIn.ai_parsed_signals && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {checkIn.ai_parsed_signals.sentiment && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        checkIn.ai_parsed_signals.sentiment === 'stressed' || checkIn.ai_parsed_signals.sentiment === 'overwhelmed'
                          ? 'bg-warning/10 text-warning'
                          : checkIn.ai_parsed_signals.sentiment === 'crisis'
                          ? 'bg-danger/10 text-danger'
                          : checkIn.ai_parsed_signals.sentiment === 'positive'
                          ? 'bg-success/10 text-success'
                          : 'bg-muted/10 text-muted'
                      }`}>
                        {checkIn.ai_parsed_signals.sentiment}
                      </span>
                    )}
                    {checkIn.ai_parsed_signals.overwhelm_level !== undefined && (
                      <span className="text-xs text-muted">
                        overwhelm: {Math.round(checkIn.ai_parsed_signals.overwhelm_level * 100)}%
                      </span>
                    )}
                    {checkIn.ai_parsed_signals.avoidance_detected && (
                      <span className="text-xs bg-danger/10 text-danger px-2 py-0.5 rounded-full">
                        avoidance
                      </span>
                    )}
                    {checkIn.ai_parsed_signals.notable_context && (
                      <span className="text-xs text-muted italic">
                        {checkIn.ai_parsed_signals.notable_context}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resolved Escalations (history) */}
      {resolvedEscalations.length > 0 && (
        <div className="bg-surface border border-border rounded-xl p-5 mb-6">
          <h2 className="text-foreground font-bold mb-4">Escalation History</h2>
          <div className="space-y-3">
            {resolvedEscalations.map((esc) => (
              <div key={esc.id} className="bg-background/50 border border-border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                      URGENCY_COLORS[esc.urgency]
                    }`}>
                      {esc.urgency}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      esc.coach_action === 'approved'
                        ? 'bg-success/20 text-success'
                        : esc.coach_action === 'overridden'
                        ? 'bg-warning/20 text-warning'
                        : 'bg-accent/20 text-accent'
                    }`}>
                      {esc.coach_action}
                    </span>
                  </div>
                  <span className="text-muted text-xs">
                    {format(new Date(esc.created_at), 'MMM d, yyyy')}
                  </span>
                </div>
                <p className="text-foreground text-sm">{esc.trigger_reason}</p>
                {esc.coach_notes && (
                  <p className="text-muted text-xs mt-1 italic">Coach: {esc.coach_notes}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action feedback toast */}
      {actionFeedback && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-surface border border-border rounded-lg px-4 py-3 shadow-lg z-50">
          <p className="text-foreground text-sm">{actionFeedback}</p>
        </div>
      )}
    </div>
  )
}
