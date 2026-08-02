/**
 * Scenario suite — executable documentation of the rules this app is built on.
 *
 * The unit tests beside each module prove the code does what the code says. This file is
 * different: each test is named for a **rule**, says *why* the rule exists, and drives the
 * real modules end to end. A contributor who breaks a decision should be told which decision
 * they broke and what it was for, not just which assertion failed.
 *
 * Every rule here was settled during the build and written into SPEC §4 and §5. Several
 * were found the hard way — §4.4 by running the app against a real database, §4.3 by
 * thinking through what happens when someone reconciles their credits a month late.
 *
 * Fixtures are fictional except where a test explicitly loads the real catalog. Every test
 * injects `asOf`; none reads the clock.
 */

import { describe, expect, it } from 'vitest'
import { loadCatalog } from '@/lib/catalog'
import { todayIn } from '@/lib/date/now'
import { addDays, parsePlainDate, type PlainDate } from '@/lib/date/plain-date'
import { formatCents, parseDollarsToCents } from '@/lib/money'
import { periodFor, periodsInRange } from '@/lib/periods'
import { cardYearFor, ledgerForCardYear, ledgerInvariantHolds } from '@/lib/ledger'
import {
  buildDashboard,
  type DashboardBenefit,
  type DashboardCard,
  type DashboardInput,
} from '@/lib/app/dashboard'

const d = parsePlainDate
const TZ = 'America/New_York'

/* -------------------------------------------------------------------------- */
/* Fixture helpers                                                            */
/* -------------------------------------------------------------------------- */

function benefit(overrides: Partial<DashboardBenefit> = {}): DashboardBenefit {
  return {
    id: 'monthly-credit',
    name: 'Monthly credit',
    merchantScope: null,
    benefitType: 'credit',
    maxValue: 1500,
    requiresEnrollment: false,
    appliesTo: 'both',
    valueMode: 'fixed',
    resetType: 'monthly',
    resetAnchor: 'calendar',
    resetInterval: 1,
    effectiveFrom: d('2020-01-01'),
    effectiveTo: null,
    ...overrides,
  }
}

function card(overrides: Partial<DashboardCard> = {}): DashboardCard {
  return {
    id: 'card-1',
    productName: 'Example Card',
    nickname: null,
    ownerDisplayName: 'Alex',
    openedOn: d('2024-03-10'),
    annualFee: 69500,
    isAuthorizedUser: false,
    benefits: [benefit()],
    excludedBenefitIds: [],
    ...overrides,
  }
}

function dashboard(overrides: Partial<DashboardInput> = {}) {
  return buildDashboard({
    cards: [card()],
    redemptions: [],
    enrollments: [],
    asOf: d('2026-07-26'),
    tz: TZ,
    ...overrides,
  })
}

function ledger(
  benefits: DashboardBenefit[],
  options: {
    openedOn?: PlainDate
    closedOn?: PlainDate
    asOf?: PlainDate
    isAuthorizedUser?: boolean
    redemptions?: { benefitId: string; periodStart: PlainDate; amount: number }[]
    enrollments?: { benefitId: string; periodStart: PlainDate }[]
    exclusions?: string[]
  } = {},
) {
  return ledgerForCardYear({
    card: {
      openedOn: options.openedOn ?? d('2024-03-10'),
      closedOn: options.closedOn,
      annualFee: 69500,
      isAuthorizedUser: options.isAuthorizedUser,
    },
    benefits,
    redemptions: options.redemptions ?? [],
    enrollments: options.enrollments ?? [],
    exclusions: options.exclusions ?? [],
    asOf: options.asOf ?? d('2026-07-26'),
    tz: TZ,
  })
}

/* ========================================================================== */
/* Calendar rules — SPEC §5.3                                                 */
/* ========================================================================== */

describe('RULE §5.3: a card opened on Feb 29 has its anniversary on Feb 28 in non-leap years', () => {
  // Why: Feb 29 exists one year in four. Without an explicit rule, three years in four
  // either throw or silently skip a cardmember year, and the annual fee covers a year that
  // the app says does not exist.
  it('lands the card year on Feb 28 in a non-leap year', () => {
    expect(cardYearFor({ openedOn: d('2024-02-29') }, d('2026-07-26'), TZ)).toEqual({
      periodStart: '2026-02-28',
      periodEnd: '2027-02-27',
      isPartial: false,
    })
  })

  it('returns to Feb 29 in the next leap year', () => {
    expect(cardYearFor({ openedOn: d('2024-02-29') }, d('2028-06-01'), TZ)?.periodStart).toBe(
      '2028-02-29',
    )
  })
})

describe('RULE §5.3: a card opened on the 31st keeps its boundary on the last day of shorter months', () => {
  // Why: naively adding a month to the previous boundary drifts — Jan 31 becomes Feb 28,
  // then Mar 28, and by December the card is a whole week out of step with the issuer.
  it('does not drift after passing through February', () => {
    const monthly = benefit({ resetAnchor: 'card_open' })
    const periods = periodsInRange(monthly, d('2026-01-31'), d('2026-01-01'), d('2026-12-31'), {
      tz: TZ,
    })
    expect(periods.map((p) => p.periodStart)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31', // not Mar 28
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
    ])
  })
})

describe('RULE §5.3: opening mid-period gives a short first period, counted at full value', () => {
  // Why: issuers do not prorate. A card opened Jan 15 still gets the whole January credit,
  // so skipping the period, or scaling it down, would understate what is actually claimable.
  it('starts the period on the open date and still counts the full amount', () => {
    const period = periodFor(benefit(), d('2026-01-15'), d('2026-01-20'), { tz: TZ })!
    expect(period).toEqual({
      periodStart: '2026-01-15',
      periodEnd: '2026-01-31',
      isPartial: true,
    })
    const result = ledger([benefit()], { openedOn: d('2026-01-15'), asOf: d('2026-01-20') })!
    const january = result.rows.find((row) => row.period.periodStart === '2026-01-15')!
    expect(january.maxValue).toBe(1500)
  })

  it('emits nothing a caller could prorate by', () => {
    const period = periodFor(benefit(), d('2026-01-15'), d('2026-01-20'), { tz: TZ })!
    expect(Object.keys(period).sort()).toEqual(['isPartial', 'periodEnd', 'periodStart'])
  })
})

describe('RULE §5.3: a card closed mid-year has no periods after closure', () => {
  // Why: a closed card cannot earn. Counting periods past closure would report forfeited
  // value for months the person no longer held the card.
  it('truncates the closing period and stops', () => {
    const context = { tz: TZ, cardClosedOn: d('2026-05-20') }
    expect(periodFor(benefit(), d('2020-01-01'), d('2026-05-10'), context)).toEqual({
      periodStart: '2026-05-01',
      periodEnd: '2026-05-20',
      isPartial: true,
    })
    expect(periodFor(benefit(), d('2020-01-01'), d('2026-06-01'), context)).toBeNull()
  })
})

describe('RULE §5.3: a benefit ending mid-year keeps its final truncated period', () => {
  // Why: a credit usable Aug 1-10 is real money with a real deadline. Dropping the period
  // because it is short would make it vanish from the dashboard exactly when it matters.
  it('truncates rather than dropping, and still counts full value', () => {
    const expiring = benefit({ effectiveTo: d('2026-08-10') })
    const period = periodFor(expiring, d('2020-01-01'), d('2026-08-05'), { tz: TZ })!
    expect(period.periodEnd).toBe('2026-08-10')
    expect(periodFor(expiring, d('2020-01-01'), d('2026-09-01'), { tz: TZ })).toBeNull()
  })
})

/* ========================================================================== */
/* Ledger rules — SPEC §4                                                     */
/* ========================================================================== */

describe('RULE §4: captured + forfeited + available always equals potential', () => {
  // Why: this is the number people trust. It holds per row, so no summation bug can break
  // it — only a clamping bug can, which is why clamping lives in one place.
  it('holds for a plain card year', () => {
    const result = ledger([benefit()])!
    expect(ledgerInvariantHolds(result.totals)).toBe(true)
  })

  it('holds per row, which is why it holds in aggregate', () => {
    const result = ledger([benefit()])!
    for (const row of result.rows) {
      expect(row.captured + row.forfeited + row.available).toBe(row.maxValue)
    }
  })
})

describe('RULE §4.1: a period belongs to the card year containing its deadline', () => {
  // Why: a calendar-annual credit overlaps two cardmember years. Assigning by overlap would
  // count one airline credit against both, inflating potential and making fee recovery
  // fiction. Assigning by periodEnd gives every period exactly one owner.
  const airline = benefit({
    id: 'airline',
    maxValue: 20000,
    resetType: 'annual',
    resetAnchor: 'calendar',
  })

  it('counts a calendar-annual credit once in a card year it straddles', () => {
    const result = ledger([airline])!
    expect(result.rows).toHaveLength(1)
    expect(result.totals.potential).toBe(20000)
  })

  it('gives the following calendar year to the following card year', () => {
    const next = ledger([airline], { asOf: d('2027-06-01') })!
    expect(next.rows[0]!.period.periodEnd).toBe('2027-12-31')
  })
})

describe('RULE §4.2: an unenrolled credit is a lapse, not an exclusion', () => {
  // Why: "excluded" is a standing judgement that a benefit does not apply. Forgetting to
  // enrol is a mistake worth surfacing — dropping it from potential would hide the single
  // most actionable thing the dashboard can show.
  const gated = benefit({ id: 'gated', requiresEnrollment: true, maxValue: 5000 })

  it('keeps unenrolled value in potential, in its own louder bucket', () => {
    const result = ledger([gated])!
    expect(result.totals.potential).toBe(12 * 5000)
    expect(result.totals.availableNotEnrolled).toBeGreaterThan(0)
    expect(result.excluded).toBe(0)
  })

  it('forfeits it when the period closes still unenrolled', () => {
    const result = ledger([gated])!
    const closed = result.rows.find((row) => row.isClosed)!
    expect(closed.forfeited).toBe(5000)
  })

  it('leaves the arithmetic untouched — enrolment only changes the label', () => {
    const result = ledger([gated])!
    expect(
      result.totals.availableEnrolled + result.totals.availableNotEnrolled,
    ).toBe(result.totals.available)
    expect(ledgerInvariantHolds(result.totals)).toBe(true)
  })
})

describe('RULE §4.3: a redemption can be backdated into a period that already closed', () => {
  // Why: every entry is made by hand, so people reconcile late. This is why there is no
  // "was it really available?" override on forfeited — the number stays derived from a
  // dated fact rather than an opinion about a number.
  it('moves value from forfeited to captured when reconciled later', () => {
    const before = ledger([benefit()])!
    const after = ledger([benefit()], {
      redemptions: [{ benefitId: 'monthly-credit', periodStart: d('2026-04-01'), amount: 1500 }],
    })!
    expect(before.totals.forfeited - after.totals.forfeited).toBe(1500)
    expect(after.totals.captured - before.totals.captured).toBe(1500)
    expect(after.totals.potential).toBe(before.totals.potential)
  })

  it('caps a fixed credit at its value so available cannot go negative', () => {
    const result = ledger([benefit()], {
      redemptions: [{ benefitId: 'monthly-credit', periodStart: d('2026-07-01'), amount: 999999 }],
    })!
    const july = result.rows.find((row) => row.period.periodStart === '2026-07-01')!
    expect(july.captured).toBe(1500)
    expect(result.totals.available).toBeGreaterThanOrEqual(0)
  })

  it('surfaces a redemption whose period no longer exists instead of dropping it', () => {
    // What editing a card's open date leaves behind. Silently swallowing it would make
    // real money disappear from the totals with no trace.
    const result = ledger([benefit()], {
      redemptions: [{ benefitId: 'monthly-credit', periodStart: d('2026-07-15'), amount: 1200 }],
    })!
    expect(result.totals.captured).toBe(0)
    expect(result.orphanedRedemptions).toEqual({ count: 1, amount: 1200 })
  })
})

describe('RULE §4.4: a benefit only counts on a card whose holder it reaches', () => {
  // Why: found by running the app against a real database. An authorized user card was
  // accruing primary-only credits, inflating potential with money nobody could claim —
  // which then forfeited and reported a loss that never happened.
  const primaryOnly = benefit({ id: 'primary-only', appliesTo: 'primary', maxValue: 1500 })
  const auOnly = benefit({ id: 'au-only', appliesTo: 'authorized_user', maxValue: 2500 })

  it('keeps a primary-only credit off an authorized user card', () => {
    expect(ledger([primaryOnly], { isAuthorizedUser: true })!.totals.potential).toBe(0)
    expect(ledger([primaryOnly], { isAuthorizedUser: false })!.totals.potential).toBe(12 * 1500)
  })

  it('keeps an authorized-user credit off the primary card', () => {
    expect(ledger([auOnly], { isAuthorizedUser: false })!.totals.potential).toBe(0)
    expect(ledger([auOnly], { isAuthorizedUser: true })!.totals.potential).toBe(12 * 2500)
  })

  it('does not report it as excluded either — it simply is not on the card', () => {
    const result = ledger([primaryOnly], { isAuthorizedUser: true })!
    expect(result.excluded).toBe(0)
  })

  it('keeps it out of the deadline list too', () => {
    const model = dashboard({
      cards: [card({ isAuthorizedUser: true, benefits: [primaryOnly] })],
    })
    expect(model.valueAtRisk).toBe(0)
  })
})

describe('RULE §4.5: dates are resolved in the household timezone, once, at the edge', () => {
  // Why: "expires Jul 31" must not become Jul 30 because the server runs in UTC. The
  // conversion happens in one place and everything downstream takes a calendar date.
  it('resolves the household date, not the server date', () => {
    const instant = new Date('2026-08-01T02:00:00Z') // 10pm Jul 31 in New York
    expect(todayIn('America/New_York', instant)).toBe('2026-07-31')
    expect(todayIn('UTC', instant)).toBe('2026-08-01')
  })

  it('cannot be changed by the timezone once asOf is a calendar date', () => {
    const ny = periodFor(benefit(), d('2020-01-01'), d('2026-07-26'), { tz: 'America/New_York' })
    const tokyo = periodFor(benefit(), d('2020-01-01'), d('2026-07-26'), { tz: 'Asia/Tokyo' })
    expect(ny).toEqual(tokyo)
  })
})

describe('RULE §4.6: a certificate is worth what you actually got for it', () => {
  // Why: a free night award has no dollar cap. Using it on a $500 room captured $500, so
  // capping at the catalog estimate would silently discard real value, and letting captured
  // exceed potential would drive available negative. The realized value replaces the
  // estimate instead.
  const certificate = benefit({
    id: 'free-night',
    maxValue: 20000,
    valueMode: 'estimated',
    resetType: 'annual',
    resetAnchor: 'card_open',
  })

  it('uses the estimate until the certificate is used, and says so', () => {
    const result = ledger([certificate])!
    expect(result.totals.potential).toBe(20000)
    expect(result.totals.estimated).toBe(20000)
    expect(result.rows[0]!.usedEstimate).toBe(true)
  })

  it('replaces the estimate with the realized value once recorded', () => {
    const result = ledger([certificate], {
      redemptions: [{ benefitId: 'free-night', periodStart: d('2026-03-10'), amount: 50000 }],
    })!
    expect(result.totals.captured).toBe(50000)
    expect(result.totals.potential).toBe(50000)
    expect(result.totals.estimated).toBe(0)
    expect(ledgerInvariantHolds(result.totals)).toBe(true)
  })

  it('keeps the invariant intact whichever value is used', () => {
    for (const amount of [0, 9000, 20000, 50000]) {
      const result = ledger([certificate], {
        redemptions: amount
          ? [{ benefitId: 'free-night', periodStart: d('2026-03-10'), amount }]
          : [],
      })!
      expect(ledgerInvariantHolds(result.totals), `amount ${amount}`).toBe(true)
    }
  })

  it('still caps an ordinary fixed credit, which is the whole distinction', () => {
    const result = ledger([benefit()], {
      redemptions: [{ benefitId: 'monthly-credit', periodStart: d('2026-07-01'), amount: 50000 }],
    })!
    expect(result.rows.find((r) => r.period.periodStart === '2026-07-01')!.captured).toBe(1500)
  })
})

describe('RULE hard-7: perks never appear in a dollar total', () => {
  // Why: a lounge membership has no claimable dollar amount. Putting a number on it would
  // make every total a matter of opinion.
  it('skips perks entirely', () => {
    const perk = benefit({ id: 'perk', benefitType: 'perk', maxValue: null })
    expect(ledger([perk])!.totals.potential).toBe(0)
    expect(dashboard({ cards: [card({ benefits: [perk] })] }).valueAtRisk).toBe(0)
  })
})

describe('RULE hard-1: money is integer cents from input to display', () => {
  // Why: floats accumulate error, and a cent lost per row is a number nobody can reconcile.
  it('never produces a float anywhere in the totals', () => {
    const result = ledger([benefit()], {
      redemptions: [{ benefitId: 'monthly-credit', periodStart: d('2026-07-01'), amount: 733 }],
    })!
    for (const value of Object.values(result.totals)) {
      expect(Number.isInteger(value)).toBe(true)
    }
  })

  it('round-trips through the render boundary', () => {
    for (const cents of [0, 7, 1500, 69500, 123456]) {
      expect(parseDollarsToCents(formatCents(cents, { alwaysCents: true }))).toBe(cents)
    }
  })

  it('refuses input it would have to round', () => {
    expect(() => parseDollarsToCents('1.005')).toThrow()
  })
})

/* ========================================================================== */
/* Dashboard rules — SPEC §6                                                  */
/* ========================================================================== */

describe('RULE §6: the hero counts only what closes within 30 days', () => {
  // Why: job one is "what is about to evaporate". A figure that includes value with eleven
  // months left is not urgent, and an urgent figure that is never urgent gets ignored.
  it('includes a period ending inside the horizon and excludes one beyond it', () => {
    const model = dashboard()
    expect(model.valueAtRisk).toBe(1500) // July only; August is 36 days out
    expect(model.nearestCliff).toEqual({ date: '2026-07-31', amount: 1500, count: 1 })
  })

  it('counts only what is still unclaimed', () => {
    const model = dashboard({
      redemptions: [
        { userCardId: 'card-1', benefitId: 'monthly-credit', periodStart: d('2026-07-01'), amount: 600 },
      ],
    })
    expect(model.valueAtRisk).toBe(900)
  })
})

describe('RULE §6: the December cliff is visible without reading', () => {
  // Why: calendar-year credits all die on the same day. If the strip does not make December
  // obvious, the app has failed at the one thing it exists for.
  it('stacks calendar-year credits into December', () => {
    const airline = benefit({
      id: 'airline',
      maxValue: 20000,
      resetType: 'annual',
      resetAnchor: 'calendar',
    })
    const model = dashboard({ cards: [card({ benefits: [benefit(), airline] })] })
    const december = model.cliffStrip.find((month) => month.month === '2026-12-01')!
    const november = model.cliffStrip.find((month) => month.month === '2026-11-01')!
    expect(december.total).toBeGreaterThan(november.total)
    expect(december.total).toBe(20000 + 1500)
  })
})

/* ========================================================================== */
/* The shipped catalog                                                        */
/* ========================================================================== */

describe('the real catalog behaves sanely through the engine', () => {
  // Why: catalog data and engine rules are edited by different people at different times.
  // This is the test that notices when a plausible-looking catalog entry produces nonsense.
  const catalog = loadCatalog({ includeTemplates: false })

  it('has at least one product, each with a sourced benefit', () => {
    expect(catalog.products.length).toBeGreaterThan(0)
    for (const { path, file } of catalog.products) {
      for (const entry of file.benefits) {
        expect(entry.source_url, `${path} ${entry.slug}`).toMatch(/^https:\/\//)
        expect(entry.verified_on, `${path} ${entry.slug}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
    }
  })

  it('produces a reconciling card year for every product', () => {
    for (const { path, file } of catalog.products) {
      const benefits: DashboardBenefit[] = file.benefits.map((entry, index) => ({
        id: `${file.product.slug}-${index}`,
        name: entry.name,
        merchantScope: entry.merchant_scope ?? null,
        benefitType: entry.benefit_type,
        maxValue: entry.benefit_type === 'credit' ? entry.max_value_cents : null,
        requiresEnrollment: entry.requires_enrollment,
        appliesTo: entry.applies_to,
        valueMode: entry.benefit_type === 'credit' ? entry.value_mode : 'fixed',
        resetType: entry.reset_type,
        resetInterval: entry.reset_interval,
        resetAnchor: entry.reset_anchor,
        effectiveFrom: entry.effective_from,
        effectiveTo: entry.effective_to ?? null,
      }))

      const result = ledger(benefits, { openedOn: d('2024-03-10'), asOf: d('2026-07-26') })
      expect(result, path).not.toBeNull()
      expect(ledgerInvariantHolds(result!.totals), path).toBe(true)
      expect(result!.totals.potential, path).toBeGreaterThanOrEqual(0)
    }
  })

  it('never lets a perk contribute value', () => {
    for (const { path, file } of catalog.products) {
      for (const entry of file.benefits) {
        if (entry.benefit_type === 'perk') {
          expect(entry, `${path} ${entry.slug}`).not.toHaveProperty('max_value_cents')
        }
      }
    }
  })

  it('gives every estimated benefit a stated basis', () => {
    for (const { path, file } of catalog.products) {
      for (const entry of file.benefits) {
        if (entry.benefit_type === 'credit' && entry.value_mode === 'estimated') {
          expect(entry.estimate_basis, `${path} ${entry.slug}`).toBeTruthy()
        }
      }
    }
  })

  it('produces contiguous periods for every credit over two years', () => {
    for (const { path, file } of catalog.products) {
      for (const entry of file.benefits) {
        if (entry.benefit_type !== 'credit') continue
        if (entry.reset_type === 'one_time') continue

        const periods = periodsInRange(
          {
            resetType: entry.reset_type,
            resetInterval: entry.reset_interval,
            resetAnchor: entry.reset_anchor,
            effectiveFrom: entry.effective_from,
            effectiveTo: entry.effective_to ?? null,
          },
          d('2026-01-01'),
          d('2026-01-01'),
          d('2027-12-31'),
          { tz: TZ },
        )
        for (let i = 0; i < periods.length - 1; i += 1) {
          expect(addDays(periods[i]!.periodEnd!, 1), `${path} ${entry.slug}`).toBe(
            periods[i + 1]!.periodStart,
          )
        }
      }
    }
  })
})

describe('a household with two people, end to end', () => {
  // The shape of the thing this app is for: two cards, two owners, one reconciling total.
  const shared = benefit({ id: 'shared', appliesTo: 'both', maxValue: 1500 })

  const model = buildDashboard({
    cards: [
      card({ id: 'a', ownerDisplayName: 'Alex', nickname: 'Travel card', benefits: [shared] }),
      card({
        id: 'b',
        ownerDisplayName: 'Sam',
        openedOn: d('2024-02-29'),
        isAuthorizedUser: true,
        benefits: [shared],
      }),
    ],
    redemptions: [
      { userCardId: 'a', benefitId: 'shared', periodStart: d('2026-07-01'), amount: 600 },
    ],
    enrollments: [],
    asOf: d('2026-07-26'),
    tz: TZ,
  })

  it('reconciles across both cards', () => {
    const bar = model.ledgerBar
    expect(bar.captured + bar.forfeited + bar.available).toBe(bar.potential)
  })

  it('attributes each row to its owner', () => {
    const initials = model.deadlineGroups.flatMap((group) =>
      group.rows.map((row) => row.ownerInitial),
    )
    expect(new Set(initials)).toEqual(new Set(['A', 'S']))
  })

  it('shows partial usage on the card it belongs to', () => {
    const alex = model.deadlineGroups[0]!.rows.find((row) => row.cardId === 'a')!
    expect(alex.captured).toBe(600)
    expect(alex.remaining).toBe(900)
  })

  it('handles the leap-day card year without special-casing', () => {
    const sam = model.cards.find((summary) => summary.card.id === 'b')!
    expect(sam.cardYear?.periodStart).toBe('2026-02-28')
  })
})
