'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'

export default function CoachLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="w-56 bg-surface border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-bold text-foreground">CoachOS</h1>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <Link
            href="/dashboard"
            className={`block px-3 py-2 rounded-md text-sm ${
              pathname === '/dashboard'
                ? 'bg-accent/10 text-accent'
                : 'text-muted hover:text-foreground hover:bg-surface'
            }`}
          >
            Dashboard
          </Link>
        </nav>
        <div className="p-3 border-t border-border">
          <button
            onClick={handleLogout}
            className="w-full text-left px-3 py-2 text-sm text-muted hover:text-foreground rounded-md"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
