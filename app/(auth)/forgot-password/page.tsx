'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/browser'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const redirectTo = `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback?next=/reset-password`

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setSent(true)
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-foreground mb-1">Reset password</h1>
        <p className="text-muted text-sm mb-8">
          Enter your email and we&apos;ll send you a link to reset your password.
        </p>

        {sent ? (
          <div className="space-y-4">
            <p className="text-foreground text-sm">
              Check your email for a link to reset your password. If you don&apos;t see it, check your spam folder.
            </p>
            <Link
              href="/login"
              className="block text-center text-sm text-accent hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-muted mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded-md text-foreground focus:outline-none focus:border-accent"
                placeholder="you@example.com"
                required
              />
            </div>

            {error && <p className="text-danger text-sm">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-accent text-white rounded-md hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-muted">
          <Link href="/login" className="text-accent hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
