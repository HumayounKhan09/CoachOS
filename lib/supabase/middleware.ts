import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Public routes
  const publicRoutes = ['/login', '/signup', '/accept-invite', '/forgot-password', '/reset-password', '/auth/callback']
  if (publicRoutes.some((route) => pathname.startsWith(route))) {
    if (user) {
      const { data: coach } = await supabase.from('coaches').select('id').eq('id', user.id).single()
      if (coach) {
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }
      const { data: client } = await supabase.from('clients').select('id').eq('id', user.id).single()
      if (client) {
        return NextResponse.redirect(new URL('/today', request.url))
      }
    }
    return supabaseResponse
  }

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const { data: coach } = await supabase.from('coaches').select('id').eq('id', user.id).single()
  const { data: client } = await supabase.from('clients').select('id').eq('id', user.id).single()

  const isCoach = !!coach
  const isClient = !!client

  if (!isCoach && !isClient) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const clientRoutes = ['/today', '/brain-dump', '/check-in']
  if (clientRoutes.some((route) => pathname.startsWith(route))) {
    if (!isClient) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  const coachRoutes = ['/dashboard', '/cases']
  if (coachRoutes.some((route) => pathname.startsWith(route))) {
    if (!isCoach) {
      return NextResponse.redirect(new URL('/today', request.url))
    }
  }

  return supabaseResponse
}
