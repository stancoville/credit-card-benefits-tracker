/**
 * Ledger math tests — SPEC §4 and the §4.1–4.4 rules.
 *
 * CLAUDE.md requires the invariant `captured + forfeited + available === potential` to be
 * asserted against generated fixtures, not one happy path. That is the last describe block;
 * it uses a seeded generator so failures are reproducible, and never the real clock.
 */

import { describe, expect, it } from 'vitest'
import { parsePlainDate } from '@/lib/date/plain-date'
import {
  cardYearFor,
  ledgerForCardYear,
  ledgerInvariantHolds,
  sumTotals,
  type LedgerBenefit,
  type LedgerInput,
  type LedgerRedemption,
} from '@/lib/ledger'

const d = parsePlainDate
const TZ = 'America/New_York'

const MONTHLY_CREDIT: LedgerBenefit = {
  id: 'monthly-credit',
  benefitType: 'credit',
  maxValue: 1500,
  requiresEnrollment: false,
  appliesTo: 'both',
  resetType: 'monthly',
  resetAnchor: 'calendar',
  resetInterval: 1,
  effectiveFrom: d('2020-01-01'),
  effectiveTo: null,
}

function benefit(overrides: Partial<LedgerBenefit> = {}): LedgerBenefit {
  return { ...MONTHLY_CREDIT, ...overrides }
}

function input(overrides: Partial<LedgerInput> = {}): LedgerInput {
  return {
    card: { openedOn: d('2024-03-10'), annualFee: 69500 },
    benefits: [benefit()],
    redemptions: [],
    enrollments: [],
    asOf: d('2026-07-26'),
    tz: TZ,
    ...overrides,
  }
}

describe('cardYearFor', () => {
  it('returns the cardmember year containing asOf', () => {
    const year = cardYearFor({ openedOn: d('2024-03-10') }, d('2026-07-26'), TZ)
    expect(year).toEqual({ periodStart: '2026-03-10', periodEnd: '2027-03-09', isPartial: false })
  })

  it('returns null before the card was opened', () => {
    expect(cardYearFor({ openedOn: d('2024-03-10') }, d('2024-03-09'), TZ)).toBeNull()
  })

  it('ends the final year at closure', () => {
    const year = cardYearFor(
      { openedOn: d('2024-03-10'), closedOn: d('2026-08-15') },
      d('2026-07-26'),
      TZ,
    )
    expect(year).toEqual({ periodStart: '2026-03-10', periodEnd: '2026-08-15', isPartial: true })
  })

  it('returns null after closure', () => {
    expect(
      cardYearFor({ openedOn: d('2024-03-10'), closedOn: d('2026-05-01') }, d('2026-07-26'), TZ),
    ).toBeNull()
  })
})

describe('§4 the four-way split', () => {
  it('splits a monthly credit across the card year', () => {
    // Card year 2026-03-10..2027-03-09. Monthly calendar credit at 1500 each.
    // Periods assigned by periodEnd: Mar 2026 (ends Mar 31) .. Feb 2027 (ends Feb 28) = 12.
    const ledger = ledgerForCardYear(input())!
    expect(ledger.rows).toHaveLength(12)
    expect(ledger.totals.potential).toBe(12 * 1500)
    expect(ledger.totals.captured).toBe(0)
    // asOf 2026-07-26: Mar, Apr, May, Jun closed = 4 periods forfeited.
    expect(ledger.totals.forfeited).toBe(4 * 1500)
    expect(ledger.totals.available).toBe(8 * 1500)
    expect(ledgerInvariantHolds(ledger.totals)).toBe(true)
  })

  it('counts a redemption as captured, not forfeited', () => {
    const redemptions: LedgerRedemption[] = [
      { benefitId: 'monthly-credit', periodStart: d('2026-04-01'), amount: 1500 },
    ]
    const ledger = ledgerForCardYear(input({ redemptions }))!
    expect(ledger.totals.captured).toBe(1500)
    expect(ledger.totals.forfeited).toBe(3 * 1500)
    expect(ledgerInvariantHolds(ledger.totals)).toBe(true)
  })

  it('handles partial usage, which is normal', () => {
    const redemptions: LedgerRedemption[] = [
      { benefitId: 'monthly-credit', periodStart: d('2026-07-01'), amount: 600 },
    ]
    const ledger = ledgerForCardYear(input({ redemptions }))!
    const july = ledger.rows.find((row) => row.period.periodStart === '2026-07-01')!
    expect(july.captured).toBe(600)
    expect(july.available).toBe(900)
    expect(july.forfeited).toBe(0)
    expect(ledgerInvariantHolds(ledger.totals)).toBe(true)
  })

  it('sums several partial redemptions in one period', () => {
    const redemptions: LedgerRedemption[] = [
      { benefitId: 'monthly-credit', periodStart: d('2026-07-01'), amount: 500 },
      { benefitId: 'monthly-credit', periodStart: d('2026-07-01'), amount: 400 },
    ]
    const ledger = ledgerForCardYear(input({ redemptions }))!
    const july = ledger.rows.find((row) => row.period.periodStart === '2026-07-01')!
    expect(july.captured).toBe(900)
    expect(july.available).toBe(600)
  })

  it('returns null when there is no card year', () => {
    expect(ledgerForCardYear(input({ asOf: d('2024-03-09') }))).toBeNull()
  })

  it('reports fee recovery as captured minus the annual fee', () => {
    const redemptions: LedgerRedemption[] = [
      { benefitId: 'monthly-credit', periodStart: d('2026-04-01'), amount: 1500 },
    ]
    const ledger = ledgerForCardYear(input({ redemptions }))!
    expect(ledger.feeRecovery).toBe(1500 - 69500)
  })
})

describe('hard rule 7 — only credits enter ledger math', () => {
  it('excludes perks from every total', () => {
    const perk = benefit({ id: 'perk', benefitType: 'perk', maxValue: null })
    const ledger = ledgerForCardYear(input({ benefits: [benefit(), perk] }))!
    expect(ledger.rows.every((row) => row.benefitId === 'monthly-credit')).toBe(true)
    expect(ledger.totals.potential).toBe(12 * 1500)
  })

  it('produces an empty ledger when a card has only perks', () => {
    const perk = benefit({ id: 'perk', benefitType: 'perk', maxValue: null })
    const ledger = ledgerForCardYear(input({ benefits: [perk] }))!
    expect(ledger.rows).toEqual([])
    expect(ledger.totals.potential).toBe(0)
    expect(ledger.capturePace.status).toBe('unknown')
    expect(ledgerInvariantHolds(ledger.totals)).toBe(true)
  })
})

describe('§4.1 a period belongs to the card year containing its periodEnd', () => {
  const airline = benefit({
    id: 'airline-credit',
    maxValue: 20000,
    resetType: 'annual',
    resetAnchor: 'calendar',
  })

  it('counts a calendar-annual credit once, not twice, in a card year it straddles', () => {
    // Card year 2026-03-10..2027-03-09 overlaps calendar 2026 AND calendar 2027.
    // Only the period ending Dec 31 2026 belongs to it.
    const ledger = ledgerForCardYear(input({ benefits: [airline] }))!
    expect(ledger.rows).toHaveLength(1)
    expect(ledger.rows[0]!.period).toEqual({
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      isPartial: false,
    })
    expect(ledger.totals.potential).toBe(20000)
  })

  it('assigns the next calendar year to the next card year', () => {
    const ledger = ledgerForCardYear(input({ benefits: [airline], asOf: d('2027-06-01') }))!
    expect(ledger.cardYear.periodStart).toBe('2027-03-10')
    expect(ledger.rows[0]!.period.periodEnd).toBe('2027-12-31')
  })

  it('does not double-count across two adjacent card years', () => {
    const first = ledgerForCardYear(input({ benefits: [airline], asOf: d('2026-07-26') }))!
    const second = ledgerForCardYear(input({ benefits: [airline], asOf: d('2027-06-01') }))!
    const ends = [first.rows[0]!.period.periodEnd, second.rows[0]!.period.periodEnd]
    expect(new Set(ends).size).toBe(2)
  })

  it('assigns an open-ended one_time period by its start instead', () => {
    const signup = benefit({
      id: 'signup-offer',
      maxValue: 50000,
      resetType: 'one_time',
      resetAnchor: 'card_open',
      effectiveFrom: d('2024-01-01'),
    })
    // The one_time period starts on the open date, so it belongs to the FIRST card year.
    const firstYear = ledgerForCardYear(input({ benefits: [signup], asOf: d('2024-06-01') }))!
    expect(firstYear.rows).toHaveLength(1)
    expect(firstYear.rows[0]!.period.periodEnd).toBeNull()
    expect(firstYear.totals.potential).toBe(50000)

    // And not to any later one.
    const laterYear = ledgerForCardYear(input({ benefits: [signup], asOf: d('2026-07-26') }))!
    expect(laterYear.rows).toEqual([])
  })

  it('never forfeits an open-ended one_time period, since it never closes', () => {
    const signup = benefit({
      id: 'signup-offer',
      maxValue: 50000,
      resetType: 'one_time',
      resetAnchor: 'card_open',
      effectiveFrom: d('2024-01-01'),
    })
    const ledger = ledgerForCardYear(input({ benefits: [signup], asOf: d('2024-06-01') }))!
    expect(ledger.totals.forfeited).toBe(0)
    expect(ledger.totals.available).toBe(50000)
  })

  it('still counts a redeemed one_time offer as captured', () => {
    // The oneTimeRedeemed flag suppresses the action, not the accounting: this money was
    // captured and must not vanish from the total.
    const signup = benefit({
      id: 'signup-offer',
      maxValue: 50000,
      resetType: 'one_time',
      resetAnchor: 'card_open',
      effectiveFrom: d('2024-01-01'),
    })
    const redemptions: LedgerRedemption[] = [
      { benefitId: 'signup-offer', periodStart: d('2024-03-10'), amount: 50000 },
    ]
    const ledger = ledgerForCardYear(
      input({ benefits: [signup], redemptions, asOf: d('2024-06-01') }),
    )!
    expect(ledger.totals.captured).toBe(50000)
    expect(ledger.totals.potential).toBe(50000)
    expect(ledger.totals.available).toBe(0)
    expect(ledgerInvariantHolds(ledger.totals)).toBe(true)
  })
})

describe('§4.2 enrollment is a lapse, not an exclusion', () => {
  const gated = benefit({ id: 'gated-credit', maxValue: 5000, requiresEnrollment: true })

  it('keeps an unenrolled credit in potential', () => {
    const ledger = ledgerForCardYear(input({ benefits: [gated] }))!
    expect(ledger.totals.potential).toBe(12 * 5000)
    expect(ledger.excluded).toBe(0)
  })

  it('reports unenrolled open value in the louder availableNotEnrolled bucket', () => {
    const ledger = ledgerForCardYear(input({ benefits: [gated] }))!
    expect(ledger.totals.availableEnrolled).toBe(0)
    expect(ledger.totals.availableNotEnrolled).toBe(8 * 5000)
    expect(ledger.totals.available).toBe(8 * 5000)
    expect(ledgerInvariantHolds(ledger.totals)).toBe(true)
  })

  it('moves a period to availableEnrolled once enrolled', () => {
    const ledger = ledgerForCardYear(
      input({
        benefits: [gated],
        enrollments: [{ benefitId: 'gated-credit', periodStart: d('2026-08-01') }],
      }),
    )!
    expect(ledger.totals.availableEnrolled).toBe(5000)
    expect(ledger.totals.availableNotEnrolled).toBe(7 * 5000)
    expect(ledger.totals.available).toBe(8 * 5000)
  })

  it('forfeits an unenrolled period once it closes, exactly like an unused one', () => {
    const ledger = ledgerForCardYear(input({ benefits: [gated] }))!
    // A calendar month is not clamped to the card-year boundary — it is a real March,
    // assigned to this card year because it ends inside it (§4.1).
    const march = ledger.rows.find((row) => row.period.periodStart === '2026-03-01')!
    expect(march.isClosed).toBe(true)
    expect(march.isEnrolled).toBe(false)
    expect(march.forfeited).toBe(5000)
    expect(march.available).toBe(0)
  })

  it('treats a benefit needing no enrollment as always enrolled', () => {
    const ledger = ledgerForCardYear(input())!
    expect(ledger.rows.every((row) => row.isEnrolled)).toBe(true)
    expect(ledger.totals.availableNotEnrolled).toBe(0)
  })
})

describe('§4 excluded is reported separately and never in potential', () => {
  it('keeps an excluded benefit out of every total', () => {
    const ledger = ledgerForCardYear(input({ exclusions: ['monthly-credit'] }))!
    expect(ledger.rows).toEqual([])
    expect(ledger.totals.potential).toBe(0)
    expect(ledger.excluded).toBe(12 * 1500)
    expect(ledgerInvariantHolds(ledger.totals)).toBe(true)
  })

  it('excludes only the named benefit', () => {
    const other = benefit({ id: 'other-credit', maxValue: 2500 })
    const ledger = ledgerForCardYear(
      input({ benefits: [benefit(), other], exclusions: ['monthly-credit'] }),
    )!
    expect(ledger.totals.potential).toBe(12 * 2500)
    expect(ledger.excluded).toBe(12 * 1500)
  })
})

describe('§4.3 true-ups and clamping', () => {
  it('moves value from forfeited to captured when a closed period is reconciled later', () => {
    const before = ledgerForCardYear(input())!
    const after = ledgerForCardYear(
      input({
        redemptions: [
          { benefitId: 'monthly-credit', periodStart: d('2026-04-01'), amount: 1500 },
        ],
      }),
    )!
    expect(before.totals.forfeited - after.totals.forfeited).toBe(1500)
    expect(after.totals.captured - before.totals.captured).toBe(1500)
    expect(after.totals.potential).toBe(before.totals.potential)
    expect(ledgerInvariantHolds(after.totals)).toBe(true)
  })

  it('clamps captured at max_value so available cannot go negative', () => {
    const ledger = ledgerForCardYear(
      input({
        redemptions: [
          { benefitId: 'monthly-credit', periodStart: d('2026-07-01'), amount: 999999 },
        ],
      }),
    )!
    const july = ledger.rows.find((row) => row.period.periodStart === '2026-07-01')!
    expect(july.captured).toBe(1500)
    expect(july.available).toBe(0)
    expect(ledger.totals.available).toBeGreaterThanOrEqual(0)
    expect(ledgerInvariantHolds(ledger.totals)).toBe(true)
  })

  it('surfaces a redemption whose period key matches nothing, rather than dropping it', () => {
    // What an edited `opened_on` leaves behind: a key no computed period produces.
    const ledger = ledgerForCardYear(
      input({
        redemptions: [
          { benefitId: 'monthly-credit', periodStart: d('2026-07-15'), amount: 1200 },
        ],
      }),
    )!
    expect(ledger.totals.captured).toBe(0)
    expect(ledger.orphanedRedemptions).toEqual({ count: 1, amount: 1200 })
    expect(ledgerInvariantHolds(ledger.totals)).toBe(true)
  })

  it('does not report redemptions from other card years as orphans', () => {
    const ledger = ledgerForCardYear(
      input({
        redemptions: [
          { benefitId: 'monthly-credit', periodStart: d('2025-04-01'), amount: 1500 },
        ],
      }),
    )!
    expect(ledger.orphanedRedemptions.count).toBe(0)
  })
})

describe('a card closed mid-year', () => {
  it('stops counting periods after closure', () => {
    const ledger = ledgerForCardYear(
      input({
        card: { openedOn: d('2024-03-10'), closedOn: d('2026-06-20'), annualFee: 69500 },
        asOf: d('2026-06-01'),
      }),
    )!
    expect(ledger.cardYear.periodEnd).toBe('2026-06-20')
    // Mar, Apr, May, Jun (truncated at closure) = 4 periods.
    expect(ledger.rows).toHaveLength(4)
    expect(ledger.rows[3]!.period).toEqual({
      periodStart: '2026-06-01',
      periodEnd: '2026-06-20',
      isPartial: true,
    })
    expect(ledgerInvariantHolds(ledger.totals)).toBe(true)
  })

  it('counts a truncated period at full value, since issuers do not prorate', () => {
    const ledger = ledgerForCardYear(
      input({
        card: { openedOn: d('2024-03-10'), closedOn: d('2026-06-02'), annualFee: 69500 },
        asOf: d('2026-06-01'),
      }),
    )!
    const june = ledger.rows.find((row) => row.period.periodStart === '2026-06-01')!
    expect(june.period.periodEnd).toBe('2026-06-02')
    expect(june.maxValue).toBe(1500)
  })
})

describe('a benefit that expires mid-card-year', () => {
  it('stops producing periods after effective_to but keeps earlier forfeitures', () => {
    const expiring = benefit({ effectiveTo: d('2026-05-10') })
    const ledger = ledgerForCardYear(input({ benefits: [expiring] }))!
    // Mar, Apr, May (truncated at effective_to) = 3 periods, all closed by 2026-07-26.
    expect(ledger.rows).toHaveLength(3)
    expect(ledger.totals.potential).toBe(3 * 1500)
    expect(ledger.totals.forfeited).toBe(3 * 1500)
    expect(ledger.totals.available).toBe(0)
    expect(ledgerInvariantHolds(ledger.totals)).toBe(true)
  })
})

describe('capture pace — SPEC §4', () => {
  it('reports behind when nothing has been captured', () => {
    const ledger = ledgerForCardYear(input())!
    expect(ledger.capturePace.capturedRatio).toBe(0)
    expect(ledger.capturePace.status).toBe('behind')
  })

  it('reports ahead when capture outruns elapsed time', () => {
    const redemptions: LedgerRedemption[] = Array.from({ length: 10 }, (_, index) => ({
      benefitId: 'monthly-credit',
      periodStart: d(`2026-${String(index + 3).padStart(2, '0')}-01`),
      amount: 1500,
    }))
    const ledger = ledgerForCardYear(input({ redemptions }))!
    expect(ledger.capturePace.status).toBe('ahead')
  })

  it('reports unknown when there is no potential to compare against', () => {
    const ledger = ledgerForCardYear(input({ benefits: [] }))!
    expect(ledger.capturePace.capturedRatio).toBeNull()
    expect(ledger.capturePace.status).toBe('unknown')
  })

  it('never exceeds 1 for elapsed, even at the very end of the card year', () => {
    const ledger = ledgerForCardYear(input({ asOf: d('2027-03-09') }))!
    expect(ledger.capturePace.elapsedRatio).toBe(1)
  })
})

describe('sumTotals', () => {
  it('adds several cards and preserves the invariant', () => {
    const a = ledgerForCardYear(input())!
    const b = ledgerForCardYear(
      input({
        card: { openedOn: d('2025-11-01'), annualFee: 39500 },
        benefits: [benefit({ id: 'other', maxValue: 2500 })],
      }),
    )!
    const combined = sumTotals([a.totals, b.totals])
    expect(combined.potential).toBe(a.totals.potential + b.totals.potential)
    expect(ledgerInvariantHolds(combined)).toBe(true)
  })

  it('returns zeroes for no cards', () => {
    const empty = sumTotals([])
    expect(empty.potential).toBe(0)
    expect(ledgerInvariantHolds(empty)).toBe(true)
  })
})

/* ========================================================================== */
/* The invariant, over generated fixtures                                     */
/* ========================================================================== */

describe('invariant over generated fixtures — captured + forfeited + available === potential', () => {
  /** Deterministic PRNG (mulberry32), so a failure is reproducible from its seed. */
  function rng(seed: number): () => number {
    let state = seed >>> 0
    return () => {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const RESET_TYPES = ['monthly', 'quarterly', 'semiannual', 'annual', 'rolling', 'one_time'] as const
  const ANCHORS = ['calendar', 'card_open'] as const
  const APPLIES_TO = ['primary', 'authorized_user', 'both'] as const
  const OPEN_DATES = ['2024-02-29', '2024-01-31', '2023-03-10', '2025-06-15', '2024-12-31'] as const
  const AS_OF = ['2025-01-01', '2026-07-26', '2026-02-28', '2026-12-31', '2027-03-09'] as const

  function scenario(seed: number): LedgerInput {
    const random = rng(seed)
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!

    const openedOn = d(pick(OPEN_DATES))
    const asOf = d(pick(AS_OF))

    const benefits: LedgerBenefit[] = Array.from(
      { length: 1 + Math.floor(random() * 4) },
      (_, index) => ({
        id: `benefit-${index}`,
        // Roughly one in five is a perk, which must stay out of every total.
        benefitType: random() < 0.2 ? 'perk' : 'credit',
        maxValue: Math.floor(random() * 40000),
        requiresEnrollment: random() < 0.4,
        appliesTo: pick(APPLIES_TO),
        resetType: pick(RESET_TYPES),
        resetInterval: 1 + Math.floor(random() * 4),
        resetAnchor: pick(ANCHORS),
        effectiveFrom: d(pick(['2020-01-01', '2024-06-01', '2026-01-01'])),
        effectiveTo: random() < 0.3 ? d(pick(['2026-05-10', '2026-12-31', '2027-06-30'])) : null,
      }),
    )

    const redemptions: LedgerRedemption[] = Array.from(
      { length: Math.floor(random() * 8) },
      () => ({
        benefitId: `benefit-${Math.floor(random() * benefits.length)}`,
        // Deliberately includes keys that match no period, and amounts that overshoot.
        periodStart: d(pick(['2026-03-10', '2026-04-01', '2026-07-01', '2026-01-01', '2026-07-15'])),
        amount: Math.floor(random() * 60000),
      }),
    )

    const enrollments = Array.from({ length: Math.floor(random() * 4) }, () => ({
      benefitId: `benefit-${Math.floor(random() * benefits.length)}`,
      periodStart: d(pick(['2026-03-10', '2026-04-01', '2026-07-01', '2026-01-01'])),
    }))

    const exclusions =
      random() < 0.25 ? [`benefit-${Math.floor(random() * benefits.length)}`] : []

    return {
      card: {
        openedOn,
        closedOn: random() < 0.2 ? d(pick(['2026-06-20', '2026-11-05', '2027-01-15'])) : undefined,
        annualFee: Math.floor(random() * 100000),
        isAuthorizedUser: random() < 0.3,
      },
      benefits,
      redemptions,
      enrollments,
      exclusions,
      asOf,
      tz: TZ,
    }
  }

  it('holds across 1000 generated scenarios', () => {
    let evaluated = 0
    for (let seed = 1; seed <= 1000; seed += 1) {
      const ledger = ledgerForCardYear(scenario(seed))
      if (ledger === null) continue
      evaluated += 1
      expect(ledgerInvariantHolds(ledger.totals), `seed ${seed}`).toBe(true)
    }
    // Guard against the loop silently skipping everything.
    expect(evaluated).toBeGreaterThan(500)
  })

  it('never reports a negative component', () => {
    for (let seed = 1; seed <= 1000; seed += 1) {
      const ledger = ledgerForCardYear(scenario(seed))
      if (ledger === null) continue
      const { potential, captured, forfeited, available } = ledger.totals
      for (const [label, value] of Object.entries({ potential, captured, forfeited, available })) {
        expect(value, `seed ${seed} ${label}`).toBeGreaterThanOrEqual(0)
      }
      expect(ledger.excluded, `seed ${seed} excluded`).toBeGreaterThanOrEqual(0)
    }
  })

  it('keeps every amount an integer, because money is integer cents', () => {
    for (let seed = 1; seed <= 1000; seed += 1) {
      const ledger = ledgerForCardYear(scenario(seed))
      if (ledger === null) continue
      for (const value of Object.values(ledger.totals)) {
        expect(Number.isInteger(value), `seed ${seed}`).toBe(true)
      }
      expect(Number.isInteger(ledger.excluded)).toBe(true)
      expect(Number.isInteger(ledger.feeRecovery)).toBe(true)
    }
  })

  it('holds per row, which is why it holds in aggregate', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const ledger = ledgerForCardYear(scenario(seed))
      if (ledger === null) continue
      for (const row of ledger.rows) {
        expect(row.captured + row.forfeited + row.available, `seed ${seed}`).toBe(row.maxValue)
      }
    }
  })

  it('never counts an excluded benefit in potential', () => {
    for (let seed = 1; seed <= 1000; seed += 1) {
      const scenarioInput = scenario(seed)
      const ledger = ledgerForCardYear(scenarioInput)
      if (ledger === null) continue
      const excludedIds = new Set(scenarioInput.exclusions ?? [])
      expect(ledger.rows.some((row) => excludedIds.has(row.benefitId))).toBe(false)
    }
  })

  it('never counts a perk in potential', () => {
    for (let seed = 1; seed <= 1000; seed += 1) {
      const scenarioInput = scenario(seed)
      const ledger = ledgerForCardYear(scenarioInput)
      if (ledger === null) continue
      const perkIds = new Set(
        scenarioInput.benefits.filter((b) => b.benefitType === 'perk').map((b) => b.id),
      )
      expect(ledger.rows.some((row) => perkIds.has(row.benefitId))).toBe(false)
    }
  })
})

describe('§3.1 applies_to — a benefit must actually reach the cardholder', () => {
  const primaryOnly = benefit({ id: 'primary-only', appliesTo: 'primary', maxValue: 1500 })
  const auOnly = benefit({ id: 'au-only', appliesTo: 'authorized_user', maxValue: 2500 })
  const both = benefit({ id: 'both', appliesTo: 'both', maxValue: 3500 })

  const primaryCard = { openedOn: d('2024-03-10'), annualFee: 69500, isAuthorizedUser: false }
  const auCard = { openedOn: d('2024-03-10'), annualFee: 0, isAuthorizedUser: true }

  it('keeps a primary-only credit off an authorized user card', () => {
    const ledger = ledgerForCardYear(input({ card: auCard, benefits: [primaryOnly] }))!
    expect(ledger.rows).toEqual([])
    expect(ledger.totals.potential).toBe(0)
  })

  it('counts a primary-only credit on the primary cardholder card', () => {
    const ledger = ledgerForCardYear(input({ card: primaryCard, benefits: [primaryOnly] }))!
    expect(ledger.totals.potential).toBe(12 * 1500)
  })

  it('keeps an authorized-user-only credit off the primary card', () => {
    const ledger = ledgerForCardYear(input({ card: primaryCard, benefits: [auOnly] }))!
    expect(ledger.totals.potential).toBe(0)
  })

  it('counts an authorized-user-only credit on the authorized user card', () => {
    const ledger = ledgerForCardYear(input({ card: auCard, benefits: [auOnly] }))!
    expect(ledger.totals.potential).toBe(12 * 2500)
  })

  it('counts a both credit on either card', () => {
    const onPrimary = ledgerForCardYear(input({ card: primaryCard, benefits: [both] }))!
    const onAu = ledgerForCardYear(input({ card: auCard, benefits: [both] }))!
    expect(onPrimary.totals.potential).toBe(12 * 3500)
    expect(onAu.totals.potential).toBe(12 * 3500)
  })

  it('treats a card with no flag as the primary cardholder', () => {
    const ledger = ledgerForCardYear(
      input({ card: { openedOn: d('2024-03-10'), annualFee: 0 }, benefits: [primaryOnly] }),
    )!
    expect(ledger.totals.potential).toBe(12 * 1500)
  })

  it('does not report an unreachable benefit as excluded either', () => {
    // It is not "not applicable to us" — it simply is not on this card.
    const ledger = ledgerForCardYear(input({ card: auCard, benefits: [primaryOnly] }))!
    expect(ledger.excluded).toBe(0)
    expect(ledgerInvariantHolds(ledger.totals)).toBe(true)
  })
})

describe('§4.6 estimated-value benefits — a certificate is worth what you got for it', () => {
  const certificate = benefit({
    id: 'free-night',
    maxValue: 20000, // the catalog's estimate, not a cap
    valueMode: 'estimated',
    resetType: 'annual',
    resetAnchor: 'card_open',
  })

  it('uses the estimate while the certificate is unused', () => {
    const ledger = ledgerForCardYear(input({ benefits: [certificate] }))!
    expect(ledger.totals.potential).toBe(20000)
    expect(ledger.totals.available).toBe(20000)
    expect(ledger.totals.estimated).toBe(20000)
    expect(ledgerInvariantHolds(ledger.totals)).toBe(true)
  })

  it('replaces the estimate with the realized value once recorded', () => {
    // A $500 room on a certificate estimated at $200 captured $500, not $200.
    const ledger = ledgerForCardYear(
      input({
        benefits: [certificate],
        redemptions: [{ benefitId: 'free-night', periodStart: d('2026-03-10'), amount: 50000 }],
      }),
    )!
    expect(ledger.totals.captured).toBe(50000)
    expect(ledger.totals.potential).toBe(50000)
    expect(ledger.totals.available).toBe(0)
    expect(ledgerInvariantHolds(ledger.totals)).toBe(true)
  })

  it('stops reporting an estimate once a real value is known', () => {
    const ledger = ledgerForCardYear(
      input({
        benefits: [certificate],
        redemptions: [{ benefitId: 'free-night', periodStart: d('2026-03-10'), amount: 50000 }],
      }),
    )!
    expect(ledger.totals.estimated).toBe(0)
    expect(ledger.rows[0]!.usedEstimate).toBe(false)
    expect(ledger.rows[0]!.isEstimated).toBe(true)
  })

  it('does not discard value above the estimate, which capping would', () => {
    const ledger = ledgerForCardYear(
      input({
        benefits: [certificate],
        redemptions: [{ benefitId: 'free-night', periodStart: d('2026-03-10'), amount: 50000 }],
      }),
    )!
    // The old clamp would have reported 20000 and silently lost $300.
    expect(ledger.totals.captured).toBeGreaterThan(20000)
  })

  it('records a realized value below the estimate honestly', () => {
    const ledger = ledgerForCardYear(
      input({
        benefits: [certificate],
        redemptions: [{ benefitId: 'free-night', periodStart: d('2026-03-10'), amount: 9000 }],
      }),
    )!
    expect(ledger.totals.captured).toBe(9000)
    expect(ledger.totals.potential).toBe(9000)
    expect(ledger.totals.forfeited).toBe(0)
    expect(ledgerInvariantHolds(ledger.totals)).toBe(true)
  })

  it('forfeits the estimate when a certificate expires unused', () => {
    const expired = benefit({
      id: 'free-night',
      maxValue: 20000,
      valueMode: 'estimated',
      resetType: 'annual',
      resetAnchor: 'calendar',
    })
    const ledger = ledgerForCardYear(input({ benefits: [expired], asOf: d('2027-02-01') }))!
    const closed = ledger.rows.find((row) => row.isClosed)
    expect(closed?.forfeited).toBe(20000)
    expect(ledger.totals.estimated).toBe(20000)
    expect(ledgerInvariantHolds(ledger.totals)).toBe(true)
  })

  it('still caps a fixed-value credit, which is the whole difference', () => {
    const ledger = ledgerForCardYear(
      input({
        benefits: [benefit({ id: 'fixed', maxValue: 1500, valueMode: 'fixed' })],
        redemptions: [{ benefitId: 'fixed', periodStart: d('2026-07-01'), amount: 50000 }],
      }),
    )!
    const july = ledger.rows.find((row) => row.period.periodStart === '2026-07-01')!
    expect(july.captured).toBe(1500)
    expect(ledger.totals.estimated).toBe(0)
  })

  it('treats a benefit with no value_mode as fixed', () => {
    const ledger = ledgerForCardYear(
      input({
        redemptions: [{ benefitId: 'monthly-credit', periodStart: d('2026-07-01'), amount: 50000 }],
      }),
    )!
    const july = ledger.rows.find((row) => row.period.periodStart === '2026-07-01')!
    expect(july.captured).toBe(1500)
    expect(july.isEstimated).toBe(false)
  })

  it('keeps the estimated portion visible when summed across cards', () => {
    const a = ledgerForCardYear(input({ benefits: [certificate] }))!
    const b = ledgerForCardYear(input({ benefits: [benefit()] }))!
    const combined = sumTotals([a.totals, b.totals])
    expect(combined.estimated).toBe(20000)
    expect(ledgerInvariantHolds(combined)).toBe(true)
  })
})
