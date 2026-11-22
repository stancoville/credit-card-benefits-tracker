/**
 * The household PIN gate's front door (SPEC §10).
 *
 * A request without a valid unlock cookie is sent to /unlock (pages) or refused with 401
 * (Server Action POSTs and anything else). This is the first check, not the only one —
 * see lib/gate/server.ts for why Server Actions and the household loader check again.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { gateConfig } from '@/lib/gate/config'
import { UNLOCK_COOKIE, verifyUnlockToken } from '@/lib/gate/token'

export async function proxy(request: NextRequest) {
  const config = gateConfig(process.env)
  if (config.mode === 'open') return NextResponse.next()

  const { pathname, search } = request.nextUrl
  if (pathname === '/unlock') return NextResponse.next()

  if (config.mode === 'on') {
    const token = request.cookies.get(UNLOCK_COOKIE)?.value
    const nowSeconds = Math.floor(Date.now() / 1000)
    if (await verifyUnlockToken(token, config.secrets, nowSeconds)) return NextResponse.next()
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new NextResponse('Locked. Reload the page and enter your PIN.', { status: 401 })
  }

  const unlock = new URL('/unlock', request.url)
  if (pathname !== '/') unlock.searchParams.set('next', `${pathname}${search}`)
  return NextResponse.redirect(unlock)
}

export const config = {
  // Everything except build assets and robots.txt, which must stay readable so crawlers
  // can see they're disallowed.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
}
