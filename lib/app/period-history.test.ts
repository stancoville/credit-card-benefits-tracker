import { describe, expect, it } from 'vitest'
import { parsePlainDate as d } from '@/lib/date/plain-date'
import type { LedgerRow } from '@/lib/ledger'
import { cadenceOf, hasPeriodGrid, periodChips, resetSummary } from './period-history'

function row(start: string, end: string, captured: number, isClosed: boolean): LedgerRow {
  const maxValue = 1500
  return {
    benefitId: 'b',
    period: { periodStart: d(start), periodEnd: d(end), isPartial: false },
    maxValue,
    captured,
    forfeited: isClosed ? maxValue - captured : 0,
    available: isClosed ? 0 : maxValue - captured,
    isClosed,
    isEnrolled: true,
    requiresEnrollment: false,
    isEstimated: false,
    usedEstimate: false,
  }
}

describe('cadenceOf', () => {
  it('names each reset rule by its cycle', () => {
    expect(cadenceOf({ resetType: 'monthly', resetInterval: 1 })).toBe('monthly')
    expect(cadenceOf({ resetType: 'quarterly', resetInterval: 1 })).toBe('quarterly')
    expect(cadenceOf({ resetType: 'semiannual', resetInterval: 1 })).toBe('semiannual')
    expect(cadenceOf({ resetType: 'annual', resetInterval: 1 })).toBe('annual')
    expect(cadenceOf({ resetType: 'one_time', resetInterval: 1 })).toBe('one_time')
  })

  it('treats equivalent spellings as the same cycle', () => {
    expect(cadenceOf({ resetType: 'monthly', resetInterval: 3 })).toBe('quarterly')
    expect(cadenceOf({ resetType: 'monthly', resetInterval: 6 })).toBe('semiannual')
    expect(cadenceOf({ resetType: 'quarterly', resetInterval: 2 })).toBe('semiannual')
    expect(cadenceOf({ resetType: 'monthly', resetInterval: 12 })).toBe('annual')
  })

  it('puts multi-year rolling credits like Global Entry together', () => {
    expect(cadenceOf({ resetType: 'rolling', resetInterval: 4 })).toBe('multi_year')
    expect(cadenceOf({ resetType: 'annual', resetInterval: 2 })).toBe('multi_year')
  })

  it('falls back to other for cycles with no common name', () => {
    expect(cadenceOf({ resetType: 'monthly', resetInterval: 2 })).toBe('other')
  })

  it('shows a grid only for cycles with several periods a year', () => {
    expect(hasPeriodGrid('monthly')).toBe(true)
    expect(hasPeriodGrid('quarterly')).toBe(true)
    expect(hasPeriodGrid('semiannual')).toBe(true)
    expect(hasPeriodGrid('annual')).toBe(false)
  })
})

describe('periodChips', () => {
  const asOf = d('2026-03-15')

  it('derives each status from the ledger row and today', () => {
    const chips = periodChips(
      [
        row('2026-01-01', '2026-01-31', 1500, true),
        row('2026-02-01', '2026-02-28', 0, true),
        row('2026-03-01', '2026-03-31', 0, false),
        row('2026-04-01', '2026-04-30', 0, false),
        row('2025-12-01', '2025-12-31', 500, true),
      ],
      'monthly',
      'calendar',
      asOf,
    )
    expect(chips.map((chip) => [chip.label, chip.status])).toEqual([
      ['Dec', 'partial'],
      ['Jan', 'used'],
      ['Feb', 'missed'],
      ['Mar', 'open'],
      ['Apr', 'upcoming'],
    ])
  })

  it('marks a closed period on its last day and the open one today, so the date maps back', () => {
    const [feb, mar, apr] = periodChips(
      [
        row('2026-02-01', '2026-02-28', 0, true),
        row('2026-03-01', '2026-03-31', 0, false),
        row('2026-04-01', '2026-04-30', 0, false),
      ],
      'monthly',
      'calendar',
      asOf,
    )
    expect(feb!.markOn).toBe('2026-02-28')
    expect(mar!.markOn).toBe('2026-03-15')
    expect(apr!.markOn).toBeNull()
  })

  it('shows the year on the first chip and where it changes', () => {
    const chips = periodChips(
      [
        row('2025-11-01', '2025-11-30', 0, true),
        row('2025-12-01', '2025-12-31', 0, true),
        row('2026-01-01', '2026-01-31', 0, true),
      ],
      'monthly',
      'calendar',
      asOf,
    )
    expect(chips.map((chip) => chip.yearLabel)).toEqual(['2025', null, '2026'])
  })

  it('labels calendar quarters Q1–Q4 and half-years by month range', () => {
    const [q2] = periodChips(
      [row('2026-04-01', '2026-06-30', 0, false)],
      'quarterly',
      'calendar',
      asOf,
    )
    expect(q2!.label).toBe('Q2')
    const [h1] = periodChips(
      [row('2026-01-01', '2026-06-30', 0, false)],
      'semiannual',
      'calendar',
      asOf,
    )
    expect(h1!.label).toBe('Jan–Jun')
  })

  it('labels card-anchored quarters by month range, since Q1 would be misleading', () => {
    const [chip] = periodChips(
      [row('2026-03-10', '2026-06-09', 0, false)],
      'quarterly',
      'card_open',
      asOf,
    )
    expect(chip!.label).toBe('Mar–Jun')
  })

  it('gives every chip a full date range for its accessible name', () => {
    const [chip] = periodChips(
      [row('2026-03-01', '2026-03-31', 0, false)],
      'monthly',
      'calendar',
      asOf,
    )
    expect(chip!.rangeLabel).toBe('Mar 1, 2026 – Mar 31, 2026')
  })
})

describe('resetSummary', () => {
  const opened = d('2024-03-10')
  it('says when each kind of credit resets', () => {
    const s = (
      resetType: 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'rolling',
      resetAnchor: 'calendar' | 'card_open',
      resetInterval = 1,
    ) => resetSummary({ resetType, resetAnchor, resetInterval }, opened)
    expect(s('monthly', 'calendar')).toBe('Resets on the 1st of each month')
    expect(s('monthly', 'card_open')).toBe('Resets on the 10th of each month')
    expect(s('quarterly', 'calendar')).toBe('Resets Jan 1, Apr 1, Jul 1, and Oct 1')
    expect(s('semiannual', 'calendar')).toBe('Resets Jan 1 and Jul 1')
    expect(s('annual', 'calendar')).toBe('Resets Jan 1')
    expect(s('annual', 'card_open')).toBe('Resets on your card anniversary, Mar 10')
    expect(s('rolling', 'card_open', 4)).toBe('Once every 4 years')
  })
})
