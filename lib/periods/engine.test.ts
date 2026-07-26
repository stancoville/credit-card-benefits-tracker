/**
 * Period engine tests — SPEC §5.2 (every reset type) and §5.3 (every named edge case).
 *
 * Every test injects `asOf`. Nothing here reads the clock, and the fixtures carry no
 * benefit amounts or real card products — those belong to the catalog (SPEC §7), which
 * this module never touches. Product names appear only in comments, to tie each reset
 * type back to the example in §5.2.
 */

import { describe, expect, it } from 'vitest'
import { addDays, addMonths, parsePlainDate, type PlainDate } from '@/lib/date/plain-date'
import {
  InvalidBenefitDefinitionError,
  comparePeriods,
  isPeriodClosed,
  periodFor,
  periodKey,
  periodsInRange,
  type BenefitPeriod,
  type PeriodBenefit,
  type PeriodContext,
} from '@/lib/periods'

const d = parsePlainDate

/** The household timezone; every date below is already resolved in it (SPEC §5.4). */
const TZ = 'America/New_York'
const ctx: PeriodContext = { tz: TZ }

function benefit(overrides: Partial<PeriodBenefit> = {}): PeriodBenefit {
  return {
    resetType: 'monthly',
    resetInterval: 1,
    resetAnchor: 'calendar',
    effectiveFrom: d('2000-01-01'),
    effectiveTo: null,
    ...overrides,
  }
}

/** Asserts a period's boundaries, keeping the expectations readable. */
function expectPeriod(
  period: BenefitPeriod | null,
  start: string,
  end: string | null,
  isPartial = false,
): void {
  expect(period).not.toBeNull()
  expect({
    periodStart: period!.periodStart,
    periodEnd: period!.periodEnd,
    isPartial: period!.isPartial,
  }).toEqual({ periodStart: start, periodEnd: end, isPartial })
}

function starts(periods: BenefitPeriod[]): string[] {
  return periods.map((p) => p.periodStart)
}

/* ========================================================================== */
/* SPEC §5.2 — one test per reset type                                        */
/* ========================================================================== */

describe('§5.2 reset types', () => {
  describe('monthly / calendar — Uber Cash, digital entertainment', () => {
    const b = benefit({ resetType: 'monthly', resetAnchor: 'calendar' })
    const opened = d('2020-01-01')

    it('returns the calendar month containing asOf', () => {
      expectPeriod(periodFor(b, opened, d('2026-07-26'), ctx), '2026-07-01', '2026-07-31')
    })

    it('ends a short month on its real last day', () => {
      expectPeriod(periodFor(b, opened, d('2026-02-14'), ctx), '2026-02-01', '2026-02-28')
      expectPeriod(periodFor(b, opened, d('2024-02-14'), ctx), '2024-02-01', '2024-02-29')
    })

    it('yields twelve contiguous periods across a year', () => {
      const periods = periodsInRange(b, opened, d('2026-01-01'), d('2026-12-31'), ctx)
      expect(periods).toHaveLength(12)
      expect(starts(periods)[0]).toBe('2026-01-01')
      expect(periods[11]!.periodEnd).toBe('2026-12-31')
    })
  })

  describe('quarterly / calendar — quarterly dining allowances', () => {
    const b = benefit({ resetType: 'quarterly', resetAnchor: 'calendar' })
    const opened = d('2020-01-01')

    it('aligns to the calendar quarters issuers publish', () => {
      expectPeriod(periodFor(b, opened, d('2026-02-01'), ctx), '2026-01-01', '2026-03-31')
      expectPeriod(periodFor(b, opened, d('2026-04-01'), ctx), '2026-04-01', '2026-06-30')
      expectPeriod(periodFor(b, opened, d('2026-07-26'), ctx), '2026-07-01', '2026-09-30')
      expectPeriod(periodFor(b, opened, d('2026-12-31'), ctx), '2026-10-01', '2026-12-31')
    })

    it('yields four periods across a year', () => {
      const periods = periodsInRange(b, opened, d('2026-01-01'), d('2026-12-31'), ctx)
      expect(starts(periods)).toEqual([
        '2026-01-01',
        '2026-04-01',
        '2026-07-01',
        '2026-10-01',
      ])
    })
  })

  describe('semiannual / calendar — Saks (Jan–Jun / Jul–Dec)', () => {
    const b = benefit({ resetType: 'semiannual', resetAnchor: 'calendar' })
    const opened = d('2020-01-01')

    it('splits the year in half on Jul 1', () => {
      expectPeriod(periodFor(b, opened, d('2026-03-15'), ctx), '2026-01-01', '2026-06-30')
      expectPeriod(periodFor(b, opened, d('2026-06-30'), ctx), '2026-01-01', '2026-06-30')
      expectPeriod(periodFor(b, opened, d('2026-07-01'), ctx), '2026-07-01', '2026-12-31')
    })

    it('yields two periods across a year', () => {
      const periods = periodsInRange(b, opened, d('2026-01-01'), d('2026-12-31'), ctx)
      expect(starts(periods)).toEqual(['2026-01-01', '2026-07-01'])
    })
  })

  describe('annual / calendar — airline fee credit, dies Dec 31', () => {
    const b = benefit({ resetType: 'annual', resetAnchor: 'calendar' })
    const opened = d('2020-01-01')

    it('runs Jan 1 to Dec 31 regardless of when the card was opened', () => {
      expectPeriod(periodFor(b, opened, d('2026-07-26'), ctx), '2026-01-01', '2026-12-31')
      expectPeriod(
        periodFor(b, d('2020-06-15'), d('2026-07-26'), ctx),
        '2026-01-01',
        '2026-12-31',
      )
    })

    it('closes the moment the calendar year turns', () => {
      const period = periodFor(b, opened, d('2026-12-31'), ctx)!
      expect(isPeriodClosed(period, d('2026-12-31'))).toBe(false)
      expect(isPeriodClosed(period, d('2027-01-01'))).toBe(true)
    })
  })

  describe('annual / card_open — Sapphire Reserve travel credit', () => {
    const b = benefit({ resetType: 'annual', resetAnchor: 'card_open' })
    const opened = d('2023-03-10')

    it('runs anniversary to anniversary', () => {
      expectPeriod(periodFor(b, opened, d('2026-07-26'), ctx), '2026-03-10', '2027-03-09')
    })

    it('flips on the anniversary itself, not the day after', () => {
      expectPeriod(periodFor(b, opened, d('2026-03-09'), ctx), '2025-03-10', '2026-03-09')
      expectPeriod(periodFor(b, opened, d('2026-03-10'), ctx), '2026-03-10', '2027-03-09')
    })

    it('starts its first period on the open date', () => {
      expectPeriod(periodFor(b, opened, d('2023-03-10'), ctx), '2023-03-10', '2024-03-09')
    })
  })

  describe('rolling / card_open — Global Entry, reset_interval = 4 years', () => {
    const b = benefit({ resetType: 'rolling', resetAnchor: 'card_open', resetInterval: 4 })
    const opened = d('2023-03-10')

    it('spans four years from the anchor', () => {
      expectPeriod(periodFor(b, opened, d('2026-07-26'), ctx), '2023-03-10', '2027-03-09')
    })

    it('resets once the four years elapse', () => {
      expectPeriod(periodFor(b, opened, d('2027-03-09'), ctx), '2023-03-10', '2027-03-09')
      expectPeriod(periodFor(b, opened, d('2027-03-10'), ctx), '2027-03-10', '2031-03-09')
    })

    it('yields one period per four years, not per year', () => {
      const periods = periodsInRange(b, opened, d('2023-01-01'), d('2035-12-31'), ctx)
      expect(starts(periods)).toEqual(['2023-03-10', '2027-03-10', '2031-03-10', '2035-03-10'])
    })
  })

  describe('one_time — one-off signup offers; never resets', () => {
    const b = benefit({ resetType: 'one_time', resetAnchor: 'card_open' })
    const opened = d('2026-01-15')

    it('has a single open-ended period when no deadline is set', () => {
      expectPeriod(periodFor(b, opened, d('2026-07-26'), ctx), '2026-01-15', null)
    })

    it('never closes without a deadline, so it can never be forfeited', () => {
      const period = periodFor(b, opened, d('2026-07-26'), ctx)!
      expect(isPeriodClosed(period, d('2099-12-31'))).toBe(false)
    })

    it('ends at effective_to when the offer has a deadline', () => {
      const dated = benefit({
        resetType: 'one_time',
        resetAnchor: 'card_open',
        effectiveFrom: d('2026-01-01'),
        effectiveTo: d('2026-04-30'),
      })
      expectPeriod(periodFor(dated, opened, d('2026-02-01'), ctx), '2026-01-15', '2026-04-30')
      expect(periodFor(dated, opened, d('2026-05-01'), ctx)).toBeNull()
    })

    it('returns exactly one period no matter how wide the range', () => {
      const periods = periodsInRange(b, opened, d('2026-01-01'), d('2040-12-31'), ctx)
      expect(periods).toHaveLength(1)
      expect(periods[0]!.periodStart).toBe('2026-01-15')
    })
  })

  describe('reset_interval multiplies the base period', () => {
    const opened = d('2020-01-01')

    it('treats monthly with interval 3 as every three months', () => {
      const b = benefit({ resetType: 'monthly', resetInterval: 3, resetAnchor: 'calendar' })
      expectPeriod(periodFor(b, opened, d('2026-07-26'), ctx), '2026-07-01', '2026-09-30')
      expect(starts(periodsInRange(b, opened, d('2026-01-01'), d('2026-12-31'), ctx))).toEqual([
        '2026-01-01',
        '2026-04-01',
        '2026-07-01',
        '2026-10-01',
      ])
    })

    it('treats monthly with interval 2 as every two months from the Jan 1 epoch', () => {
      const b = benefit({ resetType: 'monthly', resetInterval: 2, resetAnchor: 'calendar' })
      expectPeriod(periodFor(b, opened, d('2026-07-26'), ctx), '2026-07-01', '2026-08-31')
      expect(starts(periodsInRange(b, opened, d('2026-01-01'), d('2026-12-31'), ctx))).toEqual([
        '2026-01-01',
        '2026-03-01',
        '2026-05-01',
        '2026-07-01',
        '2026-09-01',
        '2026-11-01',
      ])
    })

    it('treats monthly with interval 6 as equivalent to semiannual', () => {
      const b = benefit({ resetType: 'monthly', resetInterval: 6, resetAnchor: 'calendar' })
      const s = benefit({ resetType: 'semiannual', resetAnchor: 'calendar' })
      expect(periodFor(b, opened, d('2026-07-26'), ctx)).toEqual(
        periodFor(s, opened, d('2026-07-26'), ctx),
      )
    })

    it('treats annual with interval 2 as every other cardmember year', () => {
      const b = benefit({ resetType: 'annual', resetAnchor: 'card_open', resetInterval: 2 })
      const cardOpened = d('2023-03-10')
      expectPeriod(periodFor(b, cardOpened, d('2024-01-01'), ctx), '2023-03-10', '2025-03-09')
      expectPeriod(periodFor(b, cardOpened, d('2026-07-26'), ctx), '2025-03-10', '2027-03-09')
    })
  })
})

/* ========================================================================== */
/* SPEC §5.3 — one named test per edge case                                   */
/* ========================================================================== */

describe('§5.3 edge cases', () => {
  describe('card opened Feb 29 — anniversary in non-leap years falls on Feb 28', () => {
    const b = benefit({ resetType: 'annual', resetAnchor: 'card_open' })
    const opened = d('2024-02-29')

    it('moves the anniversary to Feb 28 in a non-leap year', () => {
      expectPeriod(periodFor(b, opened, d('2025-06-01'), ctx), '2025-02-28', '2026-02-27')
    })

    it('keeps the first period intact from the leap day', () => {
      expectPeriod(periodFor(b, opened, d('2024-02-29'), ctx), '2024-02-29', '2025-02-27')
    })

    it('returns to Feb 29 at the next leap year', () => {
      expectPeriod(periodFor(b, opened, d('2028-06-01'), ctx), '2028-02-29', '2029-02-27')
    })

    it('produces no gap or overlap across the leap boundary', () => {
      const periods = periodsInRange(b, opened, d('2024-01-01'), d('2029-12-31'), ctx)
      expect(starts(periods)).toEqual([
        '2024-02-29',
        '2025-02-28',
        '2026-02-28',
        '2027-02-28',
        '2028-02-29',
        '2029-02-28',
      ])
      for (let i = 0; i < periods.length - 1; i += 1) {
        expect(addDays(periods[i]!.periodEnd!, 1)).toBe(periods[i + 1]!.periodStart)
      }
    })
  })

  describe('card opened on the 31st — monthly periods in 30-day months end on the last day', () => {
    const b = benefit({ resetType: 'monthly', resetAnchor: 'card_open' })
    const opened = d('2026-01-31')

    it('clamps each boundary to the last day of a shorter month', () => {
      const periods = periodsInRange(b, opened, d('2026-01-01'), d('2026-12-31'), ctx)
      expect(starts(periods)).toEqual([
        '2026-01-31',
        '2026-02-28', // February
        '2026-03-31',
        '2026-04-30', // 30-day month
        '2026-05-31',
        '2026-06-30', // 30-day month
        '2026-07-31',
        '2026-08-31',
        '2026-09-30', // 30-day month
        '2026-10-31',
        '2026-11-30', // 30-day month
        '2026-12-31',
      ])
    })

    it('does not drift after passing through a short month', () => {
      // A naive "add a month to the previous boundary" would land on Mar 28 here.
      expectPeriod(periodFor(b, opened, d('2026-04-15'), ctx), '2026-03-31', '2026-04-29')
    })

    it('stays contiguous every month', () => {
      const periods = periodsInRange(b, opened, d('2026-01-01'), d('2027-12-31'), ctx)
      for (let i = 0; i < periods.length - 1; i += 1) {
        expect(addDays(periods[i]!.periodEnd!, 1)).toBe(periods[i + 1]!.periodStart)
      }
    })
  })

  describe('card opened mid-period — the first period is short, not skipped', () => {
    const b = benefit({ resetType: 'monthly', resetAnchor: 'calendar' })
    const opened = d('2026-01-15')

    it('keeps the partial first period, starting on the open date', () => {
      expectPeriod(periodFor(b, opened, d('2026-01-20'), ctx), '2026-01-15', '2026-01-31', true)
    })

    it('returns to full periods immediately afterwards', () => {
      expectPeriod(periodFor(b, opened, d('2026-02-05'), ctx), '2026-02-01', '2026-02-28')
    })

    it('includes the short period in a range query rather than skipping it', () => {
      const periods = periodsInRange(b, opened, d('2026-01-01'), d('2026-03-31'), ctx)
      expect(starts(periods)).toEqual(['2026-01-15', '2026-02-01', '2026-03-01'])
      expect(periods[0]!.isPartial).toBe(true)
      expect(periods[1]!.isPartial).toBe(false)
    })

    it('reports no period before the card existed', () => {
      expect(periodFor(b, opened, d('2026-01-14'), ctx)).toBeNull()
      expect(periodsInRange(b, opened, d('2025-01-01'), d('2026-01-14'), ctx)).toEqual([])
    })

    it('emits no proration factor, so a partial period counts full max_value', () => {
      // §5.3: issuers don't prorate. The engine deliberately exposes nothing a caller
      // could multiply an amount by — only the boundaries and a partial flag.
      const period = periodFor(b, opened, d('2026-01-20'), ctx)!
      expect(Object.keys(period).sort()).toEqual(['isPartial', 'periodEnd', 'periodStart'])
    })

    it('does the same for a card opened mid-quarter', () => {
      const q = benefit({ resetType: 'quarterly', resetAnchor: 'calendar' })
      expectPeriod(periodFor(q, d('2026-02-10'), d('2026-03-01'), ctx), '2026-02-10', '2026-03-31', true)
    })
  })

  describe('benefit effective_to mid-card-year — later periods do not exist, earlier ones still forfeit', () => {
    const b = benefit({
      resetType: 'monthly',
      resetAnchor: 'calendar',
      effectiveFrom: d('2020-01-01'),
      effectiveTo: d('2026-08-10'),
    })
    const opened = d('2020-01-01')

    it('truncates the straddling period to effective_to', () => {
      expectPeriod(periodFor(b, opened, d('2026-08-05'), ctx), '2026-08-01', '2026-08-10', true)
    })

    it('reports no period after effective_to', () => {
      expect(periodFor(b, opened, d('2026-08-11'), ctx)).toBeNull()
      expect(periodFor(b, opened, d('2026-09-01'), ctx)).toBeNull()
    })

    it('stops the range query at the truncated period', () => {
      const periods = periodsInRange(b, opened, d('2026-01-01'), d('2026-12-31'), ctx)
      expect(periods).toHaveLength(8)
      expectPeriod(periods[7]!, '2026-08-01', '2026-08-10', true)
    })

    it('still counts earlier closed periods toward forfeited', () => {
      const periods = periodsInRange(b, opened, d('2026-01-01'), d('2026-12-31'), ctx)
      const july = periods[6]!
      expectPeriod(july, '2026-07-01', '2026-07-31')
      expect(isPeriodClosed(july, d('2026-09-01'))).toBe(true)
    })

    it('reports no period before effective_from', () => {
      const later = benefit({ effectiveFrom: d('2026-06-15'), effectiveTo: null })
      expect(periodFor(later, opened, d('2026-06-14'), ctx)).toBeNull()
      expectPeriod(periodFor(later, opened, d('2026-06-20'), ctx), '2026-06-15', '2026-06-30', true)
    })

    it('reports nothing when the effective window misses the card entirely', () => {
      const stale = benefit({ effectiveFrom: d('2018-01-01'), effectiveTo: d('2019-12-31') })
      expect(periodFor(stale, d('2020-01-01'), d('2020-06-01'), ctx)).toBeNull()
      expect(periodsInRange(stale, d('2020-01-01'), d('2020-01-01'), d('2030-01-01'), ctx)).toEqual([])
    })
  })

  describe('card closed mid-year — no periods after closure', () => {
    const b = benefit({ resetType: 'monthly', resetAnchor: 'calendar' })
    const opened = d('2020-01-01')
    const closed: PeriodContext = { tz: TZ, cardClosedOn: d('2026-05-20') }

    it('truncates the period containing the closure date', () => {
      expectPeriod(periodFor(b, opened, d('2026-05-10'), closed), '2026-05-01', '2026-05-20', true)
    })

    it('reports no period after the closure date', () => {
      expect(periodFor(b, opened, d('2026-05-21'), closed)).toBeNull()
      expect(periodFor(b, opened, d('2026-06-01'), closed)).toBeNull()
    })

    it('stops the range query at closure', () => {
      const periods = periodsInRange(b, opened, d('2026-01-01'), d('2026-12-31'), closed)
      expect(starts(periods)).toEqual([
        '2026-01-01',
        '2026-02-01',
        '2026-03-01',
        '2026-04-01',
        '2026-05-01',
      ])
      expect(periods[4]!.periodEnd).toBe('2026-05-20')
    })

    it('applies to a cardmember-year benefit too', () => {
      const annual = benefit({ resetType: 'annual', resetAnchor: 'card_open' })
      const cardOpened = d('2023-03-10')
      expectPeriod(
        periodFor(annual, cardOpened, d('2026-05-01'), closed),
        '2026-03-10',
        '2026-05-20',
        true,
      )
      expect(periodFor(annual, cardOpened, d('2026-06-01'), closed)).toBeNull()
    })

    it('takes whichever of closure and effective_to comes first', () => {
      const expiring = benefit({ effectiveTo: d('2026-05-05') })
      expectPeriod(periodFor(expiring, opened, d('2026-05-01'), closed), '2026-05-01', '2026-05-05', true)

      const lateExpiry = benefit({ effectiveTo: d('2026-11-30') })
      expectPeriod(periodFor(lateExpiry, opened, d('2026-05-01'), closed), '2026-05-01', '2026-05-20', true)
    })

    it('reports nothing for a card closed the day it opened', () => {
      const sameDay: PeriodContext = { tz: TZ, cardClosedOn: d('2026-01-15') }
      expectPeriod(periodFor(b, d('2026-01-15'), d('2026-01-15'), sameDay), '2026-01-15', '2026-01-15', true)
      expect(periodFor(b, d('2026-01-15'), d('2026-01-16'), sameDay)).toBeNull()
    })
  })

  describe('one_time benefit already redeemed — periodFor returns null', () => {
    const b = benefit({ resetType: 'one_time', resetAnchor: 'card_open' })
    const opened = d('2026-01-15')

    it('returns null once redeemed', () => {
      const redeemed: PeriodContext = { tz: TZ, oneTimeRedeemed: true }
      expect(periodFor(b, opened, d('2026-07-26'), redeemed)).toBeNull()
    })

    it('still returns the period when not yet redeemed', () => {
      const unredeemed: PeriodContext = { tz: TZ, oneTimeRedeemed: false }
      expectPeriod(periodFor(b, opened, d('2026-07-26'), unredeemed), '2026-01-15', null)
      expectPeriod(periodFor(b, opened, d('2026-07-26'), ctx), '2026-01-15', null)
    })

    it('returns an empty range once redeemed', () => {
      const redeemed: PeriodContext = { tz: TZ, oneTimeRedeemed: true }
      expect(periodsInRange(b, opened, d('2026-01-01'), d('2030-12-31'), redeemed)).toEqual([])
    })

    it('does not suppress recurring benefits when the flag is set', () => {
      const monthly = benefit({ resetType: 'monthly', resetAnchor: 'calendar' })
      const redeemed: PeriodContext = { tz: TZ, oneTimeRedeemed: true }
      expectPeriod(periodFor(monthly, opened, d('2026-07-26'), redeemed), '2026-07-01', '2026-07-31')
    })
  })
})

/* ========================================================================== */
/* Contract properties                                                        */
/* ========================================================================== */

describe('periodsInRange contract', () => {
  const opened = d('2020-01-01')

  it('returns periods ordered by start date', () => {
    const b = benefit({ resetType: 'monthly', resetAnchor: 'calendar' })
    const periods = periodsInRange(b, opened, d('2026-01-01'), d('2026-12-31'), ctx)
    expect([...periods].sort(comparePeriods)).toEqual(periods)
  })

  it('returns a period straddling `to` with its true end, not the query end', () => {
    const b = benefit({ resetType: 'monthly', resetAnchor: 'calendar' })
    const periods = periodsInRange(b, opened, d('2026-07-01'), d('2026-07-15'), ctx)
    expect(periods).toHaveLength(1)
    expectPeriod(periods[0]!, '2026-07-01', '2026-07-31')
  })

  it('includes a period straddling `from`', () => {
    const b = benefit({ resetType: 'quarterly', resetAnchor: 'calendar' })
    const periods = periodsInRange(b, opened, d('2026-05-15'), d('2026-06-01'), ctx)
    expect(periods).toHaveLength(1)
    expectPeriod(periods[0]!, '2026-04-01', '2026-06-30')
  })

  it('returns an empty array when the range is inverted', () => {
    const b = benefit()
    expect(periodsInRange(b, opened, d('2026-12-31'), d('2026-01-01'), ctx)).toEqual([])
  })

  it('returns a single period when from and to are the same day', () => {
    const b = benefit({ resetType: 'monthly', resetAnchor: 'calendar' })
    const periods = periodsInRange(b, opened, d('2026-07-26'), d('2026-07-26'), ctx)
    expect(periods).toHaveLength(1)
    expectPeriod(periods[0]!, '2026-07-01', '2026-07-31')
  })

  it('exposes periodStart as the redemption key', () => {
    const b = benefit({ resetType: 'monthly', resetAnchor: 'calendar' })
    const period = periodFor(b, opened, d('2026-07-26'), ctx)!
    expect(periodKey(period)).toBe('2026-07-01')
  })
})

describe('cross-checks over generated fixtures', () => {
  const cases: Array<{ name: string; benefit: PeriodBenefit; opened: PlainDate }> = [
    {
      name: 'monthly / calendar',
      benefit: benefit({ resetType: 'monthly', resetAnchor: 'calendar' }),
      opened: d('2024-03-17'),
    },
    {
      name: 'quarterly / calendar',
      benefit: benefit({ resetType: 'quarterly', resetAnchor: 'calendar' }),
      opened: d('2024-03-17'),
    },
    {
      name: 'semiannual / calendar',
      benefit: benefit({ resetType: 'semiannual', resetAnchor: 'calendar' }),
      opened: d('2024-03-17'),
    },
    {
      name: 'annual / calendar',
      benefit: benefit({ resetType: 'annual', resetAnchor: 'calendar' }),
      opened: d('2024-03-17'),
    },
    {
      name: 'annual / card_open',
      benefit: benefit({ resetType: 'annual', resetAnchor: 'card_open' }),
      opened: d('2024-02-29'),
    },
    {
      name: 'monthly / card_open opened on the 31st',
      benefit: benefit({ resetType: 'monthly', resetAnchor: 'card_open' }),
      opened: d('2024-01-31'),
    },
    {
      name: 'rolling / card_open interval 4',
      benefit: benefit({ resetType: 'rolling', resetAnchor: 'card_open', resetInterval: 4 }),
      opened: d('2024-03-17'),
    },
    {
      name: 'monthly / calendar interval 5 (does not divide 12)',
      benefit: benefit({ resetType: 'monthly', resetAnchor: 'calendar', resetInterval: 5 }),
      opened: d('2024-03-17'),
    },
  ]

  for (const { name, benefit: b, opened } of cases) {
    describe(name, () => {
      const from = d('2024-01-01')
      const to = d('2032-12-31')
      const periods = periodsInRange(b, opened, from, to, ctx)

      it('covers the range with no gaps and no overlaps', () => {
        expect(periods.length).toBeGreaterThan(0)
        for (let i = 0; i < periods.length - 1; i += 1) {
          expect(addDays(periods[i]!.periodEnd!, 1)).toBe(periods[i + 1]!.periodStart)
        }
      })

      it('never emits a period that ends before it starts', () => {
        for (const period of periods) {
          expect(period.periodEnd).not.toBeNull()
          expect(period.periodStart <= period.periodEnd!).toBe(true)
        }
      })

      it('starts on the card open date, since the first period is short not skipped', () => {
        expect(periods[0]!.periodStart).toBe(opened)
      })

      it('agrees with periodFor for every sampled date in the range', () => {
        // Sample every 11 days so the probe drifts across boundaries rather than
        // landing on the same day-of-month each time.
        let asOf = opened
        let checked = 0
        while (asOf <= to) {
          const direct = periodFor(b, opened, asOf, ctx)
          const containing = periods.find(
            (p) => p.periodStart <= asOf && (p.periodEnd === null || asOf <= p.periodEnd),
          )
          expect(direct).toEqual(containing ?? null)
          checked += 1
          asOf = addDays(asOf, 11)
        }
        expect(checked).toBeGreaterThan(200)
      })

      it('agrees with periodFor on each boundary day', () => {
        for (const period of periods) {
          expect(periodFor(b, opened, period.periodStart, ctx)).toEqual(period)
          expect(periodFor(b, opened, period.periodEnd!, ctx)).toEqual(period)
        }
      })
    })
  }
})

describe('purity and timezone handling', () => {
  const b = benefit({ resetType: 'monthly', resetAnchor: 'calendar' })
  const opened = d('2020-01-01')

  it('returns the same result for the same inputs, every time', () => {
    const first = periodFor(b, opened, d('2026-07-26'), ctx)
    const second = periodFor(b, opened, d('2026-07-26'), ctx)
    expect(first).toEqual(second)
  })

  it('does not vary with the timezone, because asOf is already resolved in it', () => {
    // SPEC §5.4: the caller converts the instant to a calendar date in the household
    // zone (lib/date/now.ts). By the time the engine sees `asOf` there is nothing left
    // to interpret, so `tz` cannot change the answer.
    const ny = periodFor(b, opened, d('2026-07-26'), { tz: 'America/New_York' })
    const tokyo = periodFor(b, opened, d('2026-07-26'), { tz: 'Asia/Tokyo' })
    const utc = periodFor(b, opened, d('2026-07-26'), { tz: 'UTC' })
    expect(ny).toEqual(tokyo)
    expect(ny).toEqual(utc)
  })

  it('does not mutate its arguments', () => {
    const definition = benefit({ resetType: 'monthly', resetAnchor: 'calendar' })
    const snapshot = { ...definition }
    periodFor(definition, opened, d('2026-07-26'), ctx)
    periodsInRange(definition, opened, d('2026-01-01'), d('2026-12-31'), ctx)
    expect(definition).toEqual(snapshot)
  })

  it('treats the last day of a period as still open', () => {
    const period = periodFor(b, opened, d('2026-07-31'), ctx)!
    expect(isPeriodClosed(period, d('2026-07-31'))).toBe(false)
    expect(isPeriodClosed(period, d('2026-08-01'))).toBe(true)
  })
})

describe('invalid definitions fail loudly', () => {
  const opened = d('2020-01-01')

  it('rejects a reset_interval below 1', () => {
    expect(() => periodFor(benefit({ resetInterval: 0 }), opened, d('2026-07-26'), ctx)).toThrow(
      InvalidBenefitDefinitionError,
    )
    expect(() => periodFor(benefit({ resetInterval: -3 }), opened, d('2026-07-26'), ctx)).toThrow(
      InvalidBenefitDefinitionError,
    )
  })

  it('rejects a non-integer reset_interval', () => {
    expect(() => periodFor(benefit({ resetInterval: 1.5 }), opened, d('2026-07-26'), ctx)).toThrow(
      InvalidBenefitDefinitionError,
    )
  })

  it('rejects an inverted effective window', () => {
    const b = benefit({ effectiveFrom: d('2026-06-01'), effectiveTo: d('2026-01-01') })
    expect(() => periodFor(b, opened, d('2026-07-26'), ctx)).toThrow(
      InvalidBenefitDefinitionError,
    )
  })

  it('accepts an effective window that is a single day', () => {
    const b = benefit({ effectiveFrom: d('2026-07-26'), effectiveTo: d('2026-07-26') })
    expectPeriod(periodFor(b, opened, d('2026-07-26'), ctx), '2026-07-26', '2026-07-26', true)
  })
})

describe('anchored arithmetic matches the date module', () => {
  it('derives cardmember-year boundaries the same way addMonths does', () => {
    const b = benefit({ resetType: 'annual', resetAnchor: 'card_open' })
    const opened = d('2024-02-29')
    for (let k = 0; k < 12; k += 1) {
      const expectedStart = addMonths(opened, k * 12)
      const period = periodFor(b, opened, expectedStart, ctx)!
      expect(period.periodStart).toBe(expectedStart)
      expect(period.periodEnd).toBe(addDays(addMonths(opened, (k + 1) * 12), -1))
    }
  })
})
