/**
 * Server-side gate checks for pages, data loaders, and Server Actions.
 *
 * `proxy.ts` turns locked requests away first, but Next.js is explicit that Proxy alone is
 * not an authorization boundary: a matcher change or a moved Server Function silently drops
 * its coverage. So every Server Action and the household loader check again here.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { gateConfig } from './config'
import { UNLOCK_COOKIE, verifyUnlockToken } from './token'

export async function isUnlocked(): Promise<boolean> {
  const config = gateConfig(process.env)
  if (config.mode === 'open') return true
  if (config.mode === 'misconfigured') return false
  const token = (await cookies()).get(UNLOCK_COOKIE)?.value
  return verifyUnlockToken(token, config.secrets, Math.floor(Date.now() / 1000))
}

/** For pages and loaders: sends a locked visitor to the PIN screen. */
export async function requireUnlocked(): Promise<void> {
  if (!(await isUnlocked())) redirect('/unlock')
}

/** For Server Actions that return a result: an error instead of a redirect. */
export async function guardLocked(): Promise<{ ok: false; error: string } | null> {
  return (await isUnlocked())
    ? null
    : { ok: false, error: 'This browser is locked. Reload the page and enter your PIN.' }
}
