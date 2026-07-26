/**
 * The only place in the app that reads the clock.
 *
 * SPEC §5.4: `asOf` is derived server-side from the household timezone, never from the
 * browser. Everything downstream — the period engine, the ledger — takes `asOf` as an
 * injected {@link PlainDate}, which is why nothing there needs a timezone at all.
 *
 * This module is deliberately outside /lib/periods so the lint rule banning `Date` in
 * the engine stays absolute.
 */

import { plainDate, type PlainDate } from './plain-date'

/**
 * Today's calendar date in the given IANA timezone.
 *
 * Correct on a UTC server: at 2026-07-31 22:00 America/New_York the server clock reads
 * 2026-08-01T02:00Z, and this still returns '2026-07-31'.
 *
 * @param timeZone IANA zone, e.g. 'America/New_York' (households.timezone)
 * @param instant  The moment to resolve; defaults to now. Pass it explicitly in tests.
 */
export function todayIn(timeZone: string, instant: Date = new Date()): PlainDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    era: 'short',
  }).formatToParts(instant)

  let year: number | undefined
  let month: number | undefined
  let day: number | undefined
  let bce = false

  for (const part of parts) {
    switch (part.type) {
      case 'year':
        year = Number(part.value)
        break
      case 'month':
        month = Number(part.value)
        break
      case 'day':
        day = Number(part.value)
        break
      case 'era':
        bce = part.value !== 'AD'
        break
      default:
        break
    }
  }

  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Could not resolve a calendar date in timezone ${JSON.stringify(timeZone)}`)
  }

  return plainDate(bce ? -year + 1 : year, month, day)
}

/**
 * Validates an IANA timezone string, so a bad `households.timezone` fails loudly at the
 * edge rather than silently resolving dates in UTC.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}
