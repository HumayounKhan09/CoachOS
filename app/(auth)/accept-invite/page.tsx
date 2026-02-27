'use client'

import { useState, useEffect, Suspense } from 'react'
import { createClient } from '@/lib/supabase/browser'
import { useRouter, useSearchParams } from 'next/navigation'

function AcceptInviteForm() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  useEffect(() => {
    const handleTokenExchange = async () => {
      const { error } = await supabase.auth.getSession()
      if (error) {
        setError('Invalid or expired invite link.')
        return
      }
      setReady(true)
    }
    handleTokenExchange()
  }, [supabase.auth])

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/today')
    router.refresh()
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-bold text-foreground mb-1">Welcome to CoachOS</h1>
      <p className="text-muted text-sm mb-8">Set your password to get started</p>

      {!ready && !error && (
        <p className="text-muted text-sm">Setting up your account...</p>
      )}

      {error && <p className="text-danger text-sm mb-4">{error}</p>}

      {ready && (
        <form onSubmit={handleSetPassword} className="space-y-4">
          <div>
            <label className="block text-sm text-muted mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-md text-foreground focus:outline-none focus:border-accent"
              required
              minLength={6}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-accent text-white rounded-md hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Setting up...' : 'Set Password & Start'}
          </button>
        </form>
      )}
    </div>
  )
}

export default function AcceptInvitePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Suspense fallback={<p className="text-muted text-sm">Loading...</p>}>
        <AcceptInviteForm />
      </Suspense>
    </div>
  )
}
