'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/browser'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [requireEmailConfirm, setRequireEmailConfirm] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/auth/callback?next=/dashboard` : undefined

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role: 'coach',
        },
        emailRedirectTo: redirectTo,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // If email confirmation is required, user will need to click the link in their email
    if (data?.user && !data?.session) {
      setError('')
      setLoading(false)
      setEmail('')
      setPassword('')
      setFullName('')
      // Show success state: check your email (handled in UI below via a state)
      setRequireEmailConfirm(true)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-foreground mb-1">CoachOS</h1>
        <p className="text-muted text-sm mb-8">Create your coaching account</p>

        {requireEmailConfirm ? (
          <div className="space-y-4">
            <p className="text-foreground text-sm">
              Check your email to confirm your account. Click the link we sent you, then you can sign in.
            </p>
            <button
              type="button"
              onClick={() => setRequireEmailConfirm(false)}
              className="text-sm text-accent hover:underline"
            >
              Use a different email
            </button>
            <p className="mt-6 text-center text-sm text-muted">
              Already have an account?{' '}
              <Link href="/login" className="text-accent hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        ) : (
        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label className="block text-sm text-muted mb-1">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-md text-foreground focus:outline-none focus:border-accent"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-md text-foreground focus:outline-none focus:border-accent"
              required
            />
          </div>
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

          {error && <p className="text-danger text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-accent text-white rounded-md hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Creating account...' : 'Create Coach Account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Already have an account?{' '}
          <Link href="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </p>
        )}
      </div>
    </div>
  )
}
