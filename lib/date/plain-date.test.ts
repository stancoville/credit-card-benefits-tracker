import { describe, expect, it } from 'vitest'
import {
  InvalidPlainDateError,
  addDays,
  addMonths,
  addYears,
  compareDates,
  daysInMonth,
  differenceInDays,
  endOfMonth,
  fromEpochDay,
  isLeapYear,
  isPlainDate,
  isWithin,
  maxDate,
  minDate,
  parsePlainDate,
  plainDate,
  plainDateClamped,
  startOfMonth,
  toEpochDay,
  toParts,
} from './plain-date'

const d = parsePlainDate

describe('parsing and validation', () => {
  it('accepts a well-formed calendar date', () => {
    expect(parsePlainDate('2026-07-26')).toBe('2026-07-26')
  })

  it('rejects a day that does not exist in that month', () => {
    expect(() => parsePlainDate('2026-02-30')).toThrow(InvalidPlainDateError)
    expect(() => parsePlainDate('2026-04-31')).toThrow(InvalidPlainDateError)
    expect(() => parsePlainDate('2025-02-29')).toThrow(InvalidPlainDateError)
  })

  it('accepts Feb 29 only in leap years', () => {
    expect(parsePlainDate('2024-02-29')).toBe('2024-02-29')
    expect(isPlainDate('2023-02-29')).toBe(false)
  })

  it('rejects malformed input', () => {
    for (const bad of ['2026-7-26', '26-07-26', '2026/07/26', '', 'today', '2026-13-01']) {
      expect(isPlainDate(bad)).toBe(false)
    }
  })

  it('round-trips through parts', () => {
    expect(toParts(d('2026-07-26'))).toEqual({ year: 2026, month: 7, day: 26 })
  })

  it('rejects out-of-range parts when constructing strictly', () => {
    expect(() => plainDate(2026, 2, 30)).toThrow(RangeError)
    expect(() => plainDate(2026, 13, 1)).toThrow(RangeError)
    expect(plainDate(2026, 7, 26)).toBe('2026-07-26')
  })

  it('clamps overflow when constructing leniently', () => {
    expect(plainDateClamped(2026, 2, 31)).toBe('2026-02-28')
    expect(plainDateClamped(2024, 2, 31)).toBe('2024-02-29')
    expect(plainDateClamped(2026, 4, 31)).toBe('2026-04-30')
  })
})

describe('leap years and month lengths', () => {
  it('applies the full Gregorian rule', () => {
    expect(isLeapYear(2024)).toBe(true)
    expect(isLeapYear(2025)).toBe(false)
    expect(isLeapYear(1900)).toBe(false) // divisible by 100, not 400
    expect(isLeapYear(2000)).toBe(true) // divisible by 400
  })

  it('reports February correctly across the rule', () => {
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2025, 2)).toBe(28)
    expect(daysInMonth(1900, 2)).toBe(28)
    expect(daysInMonth(2000, 2)).toBe(29)
  })
})

describe('epoch-day conversion', () => {
  it('anchors on the Unix epoch', () => {
    expect(toEpochDay(d('1970-01-01'))).toBe(0)
    expect(fromEpochDay(0)).toBe('1970-01-01')
  })

  it('matches known offsets', () => {
    expect(toEpochDay(d('2000-01-01'))).toBe(10957)
    expect(toEpochDay(d('1969-12-31'))).toBe(-1)
    expect(fromEpochDay(10957)).toBe('2000-01-01')
  })

  it('round-trips every day across a multi-year span including leap days', () => {
    let cursor = d('2023-01-01')
    for (let i = 0; i < 365 * 4; i += 1) {
      expect(fromEpochDay(toEpochDay(cursor))).toBe(cursor)
      cursor = addDays(cursor, 1)
    }
    expect(cursor).toBe('2026-12-31')
  })
})

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays(d('2026-01-31'), 1)).toBe('2026-02-01')
    expect(addDays(d('2026-12-31'), 1)).toBe('2027-01-01')
    expect(addDays(d('2026-03-01'), -1)).toBe('2026-02-28')
    expect(addDays(d('2024-03-01'), -1)).toBe('2024-02-29')
  })

  it('is the inverse of itself', () => {
    expect(addDays(addDays(d('2026-07-26'), 400), -400)).toBe('2026-07-26')
  })
})

describe('addMonths — the single place month-length overflow is resolved', () => {
  it('clamps the 31st into shorter months', () => {
    expect(addMonths(d('2026-01-31'), 1)).toBe('2026-02-28')
    expect(addMonths(d('2026-03-31'), 1)).toBe('2026-04-30')
    expect(addMonths(d('2026-05-31'), 1)).toBe('2026-06-30')
  })

  it('does not drift, because it always measures from the original date', () => {
    const anchor = d('2026-01-31')
    expect(addMonths(anchor, 1)).toBe('2026-02-28')
    expect(addMonths(anchor, 2)).toBe('2026-03-31') // not 2026-03-28
    expect(addMonths(anchor, 3)).toBe('2026-04-30')
  })

  it('handles negative and multi-year offsets', () => {
    expect(addMonths(d('2026-01-15'), -1)).toBe('2025-12-15')
    expect(addMonths(d('2026-01-15'), -13)).toBe('2024-12-15')
    expect(addMonths(d('2026-07-26'), 30)).toBe('2029-01-26')
  })
})

describe('addYears', () => {
  it('lands a Feb 29 anniversary on Feb 28 in non-leap years', () => {
    expect(addYears(d('2024-02-29'), 1)).toBe('2025-02-28')
    expect(addYears(d('2024-02-29'), 2)).toBe('2026-02-28')
    expect(addYears(d('2024-02-29'), 3)).toBe('2027-02-28')
  })

  it('returns to Feb 29 at the next leap year', () => {
    expect(addYears(d('2024-02-29'), 4)).toBe('2028-02-29')
  })
})

describe('month bounds', () => {
  it('finds the first and last day', () => {
    expect(startOfMonth(d('2026-07-26'))).toBe('2026-07-01')
    expect(endOfMonth(d('2026-07-26'))).toBe('2026-07-31')
    expect(endOfMonth(d('2026-02-10'))).toBe('2026-02-28')
    expect(endOfMonth(d('2024-02-10'))).toBe('2024-02-29')
  })
})

describe('comparison', () => {
  it('orders lexicographically, which is why SQL and JS agree', () => {
    const unsorted = [d('2026-12-01'), d('2026-01-15'), d('2026-07-04'), d('2025-12-31')]
    expect([...unsorted].sort()).toEqual([
      '2025-12-31',
      '2026-01-15',
      '2026-07-04',
      '2026-12-01',
    ])
  })

  it('agrees with chronological order across a sampled span', () => {
    let cursor = d('2025-01-01')
    for (let i = 0; i < 500; i += 1) {
      const next = addDays(cursor, 1)
      expect(compareDates(cursor, next)).toBeLessThan(0)
      expect(cursor < next).toBe(true)
      cursor = next
    }
  })

  it('picks the earlier and later of two dates', () => {
    expect(minDate(d('2026-07-01'), d('2026-01-01'))).toBe('2026-01-01')
    expect(maxDate(d('2026-07-01'), d('2026-01-01'))).toBe('2026-07-01')
  })

  it('treats a range as inclusive on both ends', () => {
    const start = d('2026-07-01')
    const end = d('2026-07-31')
    expect(isWithin(start, start, end)).toBe(true)
    expect(isWithin(end, start, end)).toBe(true)
    expect(isWithin(d('2026-08-01'), start, end)).toBe(false)
    expect(isWithin(d('2026-06-30'), start, end)).toBe(false)
  })
})

describe('differenceInDays', () => {
  it('counts whole days, signed', () => {
    expect(differenceInDays(d('2026-07-01'), d('2026-07-31'))).toBe(30)
    expect(differenceInDays(d('2026-07-31'), d('2026-07-01'))).toBe(-30)
    expect(differenceInDays(d('2024-02-28'), d('2024-03-01'))).toBe(2) // leap year
    expect(differenceInDays(d('2025-02-28'), d('2025-03-01'))).toBe(1)
  })
})
