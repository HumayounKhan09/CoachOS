'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'

interface TodayTask {
  id: string
  title: string
  estimated_minutes: number
  status: string
  failure_count: number
}

interface TodayData {
  today_tasks: TodayTask[]
  awaiting_check_in: boolean
  next_check_in_at: string | null
  weekly_focus: string
  case_status: string
}

export default function TodayPage() {
  const [data, setData] = useState<TodayData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [animatingOut, setAnimatingOut] = useState<string | null>(null)

  const fetchToday = useCallback(async () => {
    try {
      const res = await fetch('/api/today')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to load today view')
      }
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchToday()
  }, [fetchToday])

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [toastMessage])

  async function handleTaskAction(taskId: string, status: 'done' | 'stuck') {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to update task')
      }

      const result = await res.json()

      if (status === 'done') {
        setAnimatingOut(taskId)
        setTimeout(() => {
          setData((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              today_tasks: prev.today_tasks.filter((t) => t.id !== taskId),
            }
          })
          setAnimatingOut(null)
          setToastMessage('Nice work!')
        }, 300)
      } else if (status === 'stuck') {
        setData((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            today_tasks: prev.today_tasks.map((t) =>
              t.id === taskId ? { ...t, failure_count: t.failure_count + 1, status: 'stuck' } : t
            ),
          }
        })
        if (result.escalation_created) {
          setToastMessage('Got it — your coach has been notified.')
        } else {
          setToastMessage("Got it — we'll adjust.")
        }
      }
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-surface rounded w-24" />
          <div className="h-4 bg-surface rounded w-48" />
          <div className="h-32 bg-surface rounded" />
          <div className="h-32 bg-surface rounded" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-8">
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4">
          <p className="text-danger text-sm">{error}</p>
          <button
            onClick={() => { setError(null); setLoading(true); fetchToday() }}
            className="mt-2 text-sm text-accent hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!data) return null

  const hasTasks = data.today_tasks.length > 0
  const allDone = data.case_status === 'active' && data.weekly_focus && !hasTasks

  return (
    <div className="max-w-lg mx-auto px-4 pt-8 pb-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Today</h1>
        {data.weekly_focus && (
          <p className="text-muted italic mt-1">{data.weekly_focus}</p>
        )}
      </div>

      {/* Check-in Banner */}
      {data.awaiting_check_in && (
        <Link href="/check-in">
          <div className="mb-6 bg-accent/10 border border-accent/30 rounded-lg p-4 flex items-center justify-between hover:bg-accent/15 transition-colors">
            <div>
              <p className="text-accent font-medium text-sm">Check-in ready</p>
              <p className="text-muted text-xs mt-0.5">Take a moment to reflect on your progress</p>
            </div>
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </Link>
      )}

      {/* Empty State — no plan */}
      {!data.weekly_focus && !hasTasks && (
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface flex items-center justify-center">
            <svg className="w-8 h-8 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <p className="text-foreground font-medium mb-2">No plan yet</p>
          <p className="text-muted text-sm mb-6">Start with a brain dump to create your plan</p>
          <Link
            href="/brain-dump"
            className="inline-flex items-center px-6 py-3 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors"
          >
            Start Brain Dump
          </Link>
        </div>
      )}

      {/* All Done State */}
      {allDone && (
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-success/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-foreground font-medium mb-2">All done for now!</p>
          <p className="text-muted text-sm">Great work. Take a break or add more tasks.</p>
        </div>
      )}

      {/* Task Cards */}
      {hasTasks && (
        <div className="space-y-3">
          {data.today_tasks.map((task) => (
            <div
              key={task.id}
              className={`bg-surface border border-border rounded-lg p-4 transition-all duration-300 ${
                animatingOut === task.id ? 'opacity-0 translate-x-4' : 'opacity-100'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 mr-3">
                  <h3 className="text-foreground font-medium text-sm">{task.title}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    {task.estimated_minutes && (
                      <span className="text-muted text-xs flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {task.estimated_minutes} min
                      </span>
                    )}
                    {task.failure_count > 0 && (
                      <span className="text-warning text-xs">
                        Attempted {task.failure_count}x
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleTaskAction(task.id, 'done')}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md bg-success/10 text-success text-sm font-medium hover:bg-success/20 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Done
                </button>
                <button
                  onClick={() => handleTaskAction(task.id, 'stuck')}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md bg-danger/10 text-danger text-sm font-medium hover:bg-danger/20 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Stuck
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer: Next check-in */}
      {data.next_check_in_at && (
        <div className="mt-8 text-center">
          <p className="text-muted text-xs">
            Next check-in:{' '}
            {formatDistanceToNow(new Date(data.next_check_in_at), { addSuffix: true })}
          </p>
        </div>
      )}

      {/* Floating Action Button */}
      <Link
        href="/brain-dump"
        className="fixed bottom-24 right-4 w-14 h-14 bg-accent rounded-full flex items-center justify-center shadow-lg hover:bg-accent/90 transition-colors z-10"
      >
        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </Link>

      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 bg-surface border border-border rounded-lg px-4 py-3 shadow-lg z-50 animate-fade-in">
          <p className="text-foreground text-sm">{toastMessage}</p>
        </div>
      )}
    </div>
  )
}
