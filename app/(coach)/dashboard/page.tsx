'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface CaseItem {
  id: string
  client_name: string
  client_email: string
  computed_status: 'needs_review' | 'drifting' | 'on_track' | 'inactive'
  drift_score: number
  adherence_rate: number
  overwhelm_score: number
  last_check_in_at: string | null
  last_check_in_relative: string
  pending_escalations: number
  weekly_focus: string
}

interface CasesResponse {
  cases: CaseItem[]
  summary: {
    total: number
    needs_review: number
    drifting: number
    on_track: number
    inactive: number
  }
}

type FilterType = 'all' | 'needs_review' | 'drifting' | 'on_track' | 'inactive'

const STATUS_COLORS: Record<string, string> = {
  needs_review: 'border-l-danger',
  drifting: 'border-l-warning',
  on_track: 'border-l-success',
  inactive: 'border-l-muted',
}

const STATUS_BADGE_COLORS: Record<string, string> = {
  needs_review: 'bg-danger/20 text-danger',
  drifting: 'bg-warning/20 text-warning',
  on_track: 'bg-success/20 text-success',
  inactive: 'bg-muted/20 text-muted',
}

const STATUS_LABELS: Record<string, string> = {
  needs_review: 'Needs Review',
  drifting: 'Drifting',
  on_track: 'On Track',
  inactive: 'Inactive',
}

const FILTER_OPTIONS: Array<{ value: FilterType; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'needs_review', label: 'Needs Review' },
  { value: 'drifting', label: 'Drifting' },
  { value: 'on_track', label: 'On Track' },
]

export default function DashboardPage() {
  const router = useRouter()
  const [data, setData] = useState<CasesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterType>('all')

  // Invite modal state
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState(false)

  const fetchCases = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filter !== 'all') params.set('filter', filter)
      const res = await fetch(`/api/cases?${params.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to load cases')
      }
      const json: CasesResponse = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    setLoading(true)
    fetchCases()
  }, [fetchCases])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim() || !inviteName.trim()) return
    setInviteLoading(true)
    setInviteError(null)

    try {
      const res = await fetch('/api/auth/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          full_name: inviteName.trim(),
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to send invite')
      }

      setInviteSuccess(true)
      setInviteEmail('')
      setInviteName('')
      // Refresh cases list after invite
      setTimeout(() => {
        setInviteSuccess(false)
        setShowInvite(false)
        fetchCases()
      }, 2000)
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setInviteLoading(false)
    }
  }

  function getScoreColor(score: number, isInverse: boolean = false) {
    if (isInverse) {
      // For adherence: high is good
      if (score > 0.7) return 'text-success'
      if (score > 0.4) return 'text-warning'
      return 'text-danger'
    }
    // For drift/overwhelm: high is bad
    if (score > 0.5) return 'text-danger'
    if (score > 0.3) return 'text-warning'
    return 'text-success'
  }

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Your Clients</h1>
          {data && (
            <div className="flex items-center gap-3 mt-1">
              <span className="text-muted text-sm">{data.summary.total} total</span>
              {data.summary.needs_review > 0 && (
                <span className="text-danger text-sm">{data.summary.needs_review} need review</span>
              )}
              {data.summary.drifting > 0 && (
                <span className="text-warning text-sm">{data.summary.drifting} drifting</span>
              )}
              <span className="text-success text-sm">{data.summary.on_track} on track</span>
            </div>
          )}
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Invite Client
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 mb-6">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === opt.value
                ? 'bg-accent text-white'
                : 'bg-surface border border-border text-muted hover:text-foreground'
            }`}
          >
            {opt.label}
            {data && opt.value !== 'all' && (
              <span className="ml-1 opacity-70">
                ({data.summary[opt.value as keyof typeof data.summary]})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 mb-4">
          <p className="text-danger text-sm">{error}</p>
          <button
            onClick={() => { setError(null); setLoading(true); fetchCases() }}
            className="mt-2 text-sm text-accent hover:underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse bg-surface border border-border rounded-lg p-4 h-20" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && data && data.cases.length === 0 && (
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface flex items-center justify-center">
            <svg className="w-8 h-8 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <p className="text-foreground font-medium mb-2">No clients yet</p>
          <p className="text-muted text-sm mb-6">Invite your first client to get started.</p>
          <button
            onClick={() => setShowInvite(true)}
            className="inline-flex items-center px-6 py-3 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors"
          >
            Invite Client
          </button>
        </div>
      )}

      {/* Case rows */}
      {!loading && data && data.cases.length > 0 && (
        <div className="space-y-2">
          {data.cases.map((caseItem) => (
            <button
              key={caseItem.id}
              onClick={() => router.push(`/cases/${caseItem.id}`)}
              className={`w-full text-left bg-surface border border-border border-l-4 rounded-lg p-4 hover:bg-surface/80 transition-colors ${
                STATUS_COLORS[caseItem.computed_status]
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div>
                    <h3 className="text-foreground font-medium text-sm">{caseItem.client_name}</h3>
                    <p className="text-muted text-xs">{caseItem.client_email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {caseItem.pending_escalations > 0 && (
                    <span className="bg-danger text-white text-xs font-bold px-2 py-0.5 rounded-full">
                      {caseItem.pending_escalations}
                    </span>
                  )}
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    STATUS_BADGE_COLORS[caseItem.computed_status]
                  }`}>
                    {STATUS_LABELS[caseItem.computed_status]}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs">
                <span className="text-muted">
                  Drift:{' '}
                  <span className={getScoreColor(caseItem.drift_score)}>
                    {Math.round(caseItem.drift_score * 100)}%
                  </span>
                </span>
                <span className="text-muted">
                  Adherence:{' '}
                  <span className={getScoreColor(caseItem.adherence_rate, true)}>
                    {Math.round(caseItem.adherence_rate * 100)}%
                  </span>
                </span>
                <span className="text-muted">
                  Last check-in:{' '}
                  <span className="text-foreground/70">
                    {caseItem.last_check_in_relative || 'Never'}
                  </span>
                </span>
                {caseItem.weekly_focus && (
                  <span className="text-muted/70 italic truncate max-w-[200px]">
                    {caseItem.weekly_focus}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Invite Modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-foreground">Invite Client</h2>
              <button
                onClick={() => { setShowInvite(false); setInviteError(null); setInviteSuccess(false) }}
                className="text-muted hover:text-foreground transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {inviteSuccess ? (
              <div className="text-center py-4">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-success/10 flex items-center justify-center">
                  <svg className="w-6 h-6 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-foreground font-medium">Invite sent!</p>
                <p className="text-muted text-sm mt-1">They&apos;ll receive an email to get started.</p>
              </div>
            ) : (
              <form onSubmit={handleInvite}>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-muted mb-1">Full name</label>
                    <input
                      type="text"
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                      placeholder="Jane Student"
                      className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-foreground text-sm placeholder:text-muted/60 focus:outline-none focus:border-accent/50 transition-colors"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-muted mb-1">Email</label>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="jane@example.com"
                      className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-foreground text-sm placeholder:text-muted/60 focus:outline-none focus:border-accent/50 transition-colors"
                      required
                    />
                  </div>
                </div>

                {inviteError && (
                  <div className="mt-3 bg-danger/10 border border-danger/30 rounded-lg p-2.5">
                    <p className="text-danger text-xs">{inviteError}</p>
                  </div>
                )}

                <div className="mt-4 flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => { setShowInvite(false); setInviteError(null) }}
                    className="px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={inviteLoading || !inviteEmail.trim() || !inviteName.trim()}
                    className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {inviteLoading ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Sending...
                      </>
                    ) : (
                      'Send Invite'
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
