/**
 * `todayIn` is the only clock reader in the app, so it is also the only test that may
 * construct an instant — and it injects that instant rather than reading the clock.
 */

import { describe, expect, it } from 'vitest'
import { isValidTimeZone, todayIn } from './now'

describe('todayIn — SPEC §5.4', () => {
  it('resolves the household calendar date, not the server one', () => {
    // 22:00 on Jul 31 in New York is already Aug 1 in UTC.
    const instant = new Date('2026-08-01T02:00:00Z')
    expect(todayIn('America/New_York', instant)).toBe('2026-07-31')
    expect(todayIn('UTC', instant)).toBe('2026-08-01')
  })

  it('handles a zone ahead of UTC', () => {
    // 08:00 on Jul 27 in Tokyo is still Jul 26 in UTC.
    const instant = new Date('2026-07-26T23:00:00Z')
    expect(todayIn('Asia/Tokyo', instant)).toBe('2026-07-27')
    expect(todayIn('UTC', instant)).toBe('2026-07-26')
  })

  it('does not shift the date across a DST transition', () => {
    // US DST ends 2026-11-01 at 02:00 local; both sides are still Nov 1 locally.
    expect(todayIn('America/New_York', new Date('2026-11-01T05:30:00Z'))).toBe('2026-11-01')
    expect(todayIn('America/New_York', new Date('2026-11-01T06:30:00Z'))).toBe('2026-11-01')
  })

  it('returns a value the rest of the app can use as a PlainDate', () => {
    const asOf = todayIn('America/New_York', new Date('2026-07-26T12:00:00Z'))
    expect(asOf).toBe('2026-07-26')
  })

  it('rejects an unusable timezone rather than silently falling back to UTC', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true)
    expect(isValidTimeZone('Not/AZone')).toBe(false)
    expect(() => todayIn('Not/AZone', new Date('2026-07-26T12:00:00Z'))).toThrow()
  })
})
