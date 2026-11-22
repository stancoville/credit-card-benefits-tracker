'use server'

/**
 * Unlocking with the household PIN (SPEC §10).
 *
 * Every submission is logged to `unlock_attempts` before the answer is returned, and the
 * limits in lib/gate/limit.ts are checked *before* the PIN is compared — a locked-out
 * guesser learns nothing from a correct guess.
 */

import { and, count, eq, gte, lt, sql } from 'drizzle-orm'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getDb } from '@/db/client'
import { unlockAttempts } from '@/db/schema'
import { gateConfig } from '@/lib/gate/config'
import {
  ATTEMPT_RETENTION_HOURS,
  GLOBAL_WINDOW_MINUTES,
  PER_IP_WINDOW_MINUTES,
  lockoutFor,
} from '@/lib/gate/limit'
import {
  UNLOCK_COOKIE,
  UNLOCK_TTL_SECONDS,
  createUnlockToken,
  pinMatches,
  safeNextPath,
} from '@/lib/gate/token'

export type UnlockResult = { error: string } | null

function field(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

function minutesAgo(minutes: number) {
  return sql`now() - make_interval(mins => ${minutes})`
}

/** Vercel sets `x-forwarded-for`; its first entry is the client. */
async function clientIp(): Promise<string> {
  const list = await headers()
  const forwarded = list.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || list.get('x-real-ip') || 'unknown'
}

async function failureCount(since: number, ip?: string): Promise<number> {
  const conditions = [
    eq(unlockAttempts.succeeded, false),
    gte(unlockAttempts.attemptedAt, minutesAgo(since)),
  ]
  if (ip !== undefined) conditions.push(eq(unlockAttempts.ip, ip))
  const rows = await getDb()
    .select({ n: count() })
    .from(unlockAttempts)
    .where(and(...conditions))
  return rows[0]?.n ?? 0
}

export async function unlock(_previous: UnlockResult, formData: FormData): Promise<UnlockResult> {
  const config = gateConfig(process.env)
  const next = safeNextPath(field(formData, 'next'))
  if (config.mode === 'open') redirect(next)
  if (config.mode === 'misconfigured') {
    return { error: 'The PIN isn’t set up on this deployment. Set HOUSEHOLD_PIN and UNLOCK_SECRET.' }
  }

  const db = getDb()
  const ip = await clientIp()

  await db
    .delete(unlockAttempts)
    .where(lt(unlockAttempts.attemptedAt, minutesAgo(ATTEMPT_RETENTION_HOURS * 60)))

  const lockout = lockoutFor({
    ipFailures: await failureCount(PER_IP_WINDOW_MINUTES, ip),
    globalFailures: await failureCount(GLOBAL_WINDOW_MINUTES),
  })
  if (lockout === 'address') {
    return { error: `Too many wrong tries. Wait ${PER_IP_WINDOW_MINUTES} minutes, then try again.` }
  }
  if (lockout === 'everyone') {
    return {
      error: `The PIN screen is paused after too many wrong tries. Try again in an hour.`,
    }
  }

  const submitted = field(formData, 'pin')
  const succeeded = submitted !== '' && (await pinMatches(submitted, config.secrets.pin))
  await db.insert(unlockAttempts).values({ ip, succeeded })

  if (!succeeded) return { error: 'That PIN didn’t match. Try again.' }

  const token = await createUnlockToken(config.secrets, Math.floor(Date.now() / 1000))
  ;(await cookies()).set(UNLOCK_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: UNLOCK_TTL_SECONDS,
  })
  redirect(next)
}
