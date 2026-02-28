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
      // Already authenticated - redirect to appropriate home
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (profile?.role === 'coach') {
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }
      return NextResponse.redirect(new URL('/today', request.url))
    }
    return supabaseResponse
  }

  // Not authenticated
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Get user role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = profile?.role

  // Client routes
  const clientRoutes = ['/today', '/brain-dump', '/check-in']
  if (clientRoutes.some((route) => pathname.startsWith(route))) {
    if (role !== 'client') {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  // Coach routes
  const coachRoutes = ['/dashboard', '/cases']
  if (coachRoutes.some((route) => pathname.startsWith(route))) {
    if (role !== 'coach') {
      return NextResponse.redirect(new URL('/today', request.url))
    }
  }

  return supabaseResponse
}
