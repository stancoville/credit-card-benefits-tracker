/**
 * Dashboard view model tests — SPEC §6.
 *
 * Fixtures are fictional and carry no real product names or amounts. Every test injects
 * `asOf`.
 */

import { describe, expect, it } from 'vitest'
import { parsePlainDate } from '@/lib/date/plain-date'
import {
  AT_RISK_DAYS,
  buildCliffStrip,
  buildDashboard,
  groupByDeadline,
  type DashboardBenefit,
  type DashboardCard,
  type DashboardInput,
} from './dashboard'

const d = parsePlainDate
const TZ = 'America/New_York'

function benefit(overrides: Partial<DashboardBenefit> = {}): DashboardBenefit {
  return {
    id: 'monthly-credit',
    name: 'Monthly credit',
    merchantScope: null,
    benefitType: 'credit',
    maxValue: 1500,
    requiresEnrollment: false,
    appliesTo: 'both',
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
    productName: 'Example Premium Card',
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

function input(overrides: Partial<DashboardInput> = {}): DashboardInput {
  return {
    cards: [card()],
    redemptions: [],
    enrollments: [],
    asOf: d('2026-07-26'),
    tz: TZ,
    ...overrides,
  }
}

describe('hero — value at risk', () => {
  it('counts unclaimed value in periods closing within 30 days', () => {
    // asOf 2026-07-26. July period ends Jul 31 (5 days) — at risk.
    // August ends Aug 31 (36 days) — beyond the horizon.
    const model = buildDashboard(input())
    expect(model.valueAtRisk).toBe(1500)
  })

  it('excludes value already claimed', () => {
    const model = buildDashboard(
      input({
        redemptions: [
          { userCardId: 'card-1', benefitId: 'monthly-credit', periodStart: d('2026-07-01'), amount: 600 },
        ],
      }),
    )
    expect(model.valueAtRisk).toBe(900)
  })

  it('drops a fully used period out of the action list entirely', () => {
    const model = buildDashboard(
      input({
        redemptions: [
          { userCardId: 'card-1', benefitId: 'monthly-credit', periodStart: d('2026-07-01'), amount: 1500 },
        ],
      }),
    )
    expect(model.valueAtRisk).toBe(0)
    expect(model.deadlineGroups).toEqual([])
  })

  it('sums across cards and owners', () => {
    const second = card({
      id: 'card-2',
      ownerDisplayName: 'Sam',
      benefits: [benefit({ id: 'other-credit', maxValue: 2500 })],
    })
    const model = buildDashboard(input({ cards: [card(), second] }))
    expect(model.valueAtRisk).toBe(1500 + 2500)
  })

  it('reports the nearest cliff with its date, amount, and count', () => {
    const second = card({
      id: 'card-2',
      benefits: [benefit({ id: 'other-credit', maxValue: 2500 })],
    })
    const model = buildDashboard(input({ cards: [card(), second] }))
    expect(model.nearestCliff).toEqual({ date: '2026-07-31', amount: 4000, count: 2 })
  })

  it('reports no cliff when nothing is at risk', () => {
    const quarterly = benefit({ resetType: 'quarterly' })
    // asOf 2026-07-26; the quarter ends Sep 30, which is 66 days out.
    const model = buildDashboard(input({ cards: [card({ benefits: [quarterly] })] }))
    expect(model.valueAtRisk).toBe(0)
    expect(model.nearestCliff).toBeNull()
  })

  it('treats a period ending exactly on the horizon as at risk', () => {
    const model = buildDashboard(input({ asOf: d('2026-07-01') }))
    // Jul 1 → Jul 31 is exactly 30 days.
    expect(AT_RISK_DAYS).toBe(30)
    expect(model.valueAtRisk).toBe(1500)
  })

  it('ignores closed periods, which are history rather than actions', () => {
    const expired = benefit({ effectiveTo: d('2026-06-30') })
    const model = buildDashboard(input({ cards: [card({ benefits: [expired] })] }))
    expect(model.valueAtRisk).toBe(0)
    expect(model.deadlineGroups).toEqual([])
  })
})

describe('deadline groups', () => {
  it('groups rows sharing a deadline, soonest first', () => {
    const monthly = benefit({ id: 'monthly-credit' })
    const alsoMonthly = benefit({ id: 'second-monthly', maxValue: 4000 })
    const model = buildDashboard(
      input({ cards: [card({ benefits: [monthly, alsoMonthly] })] }),
    )
    expect(model.deadlineGroups).toHaveLength(1)
    expect(model.deadlineGroups[0]!.periodEnd).toBe('2026-07-31')
    expect(model.deadlineGroups[0]!.total).toBe(5500)
    expect(model.deadlineGroups[0]!.rows).toHaveLength(2)
  })

  it('orders the largest amount first inside a group', () => {
    const small = benefit({ id: 'small', maxValue: 1000 })
    const large = benefit({ id: 'large', maxValue: 9000 })
    const model = buildDashboard(input({ cards: [card({ benefits: [small, large] })] }))
    expect(model.deadlineGroups[0]!.rows.map((row) => row.benefitId)).toEqual(['large', 'small'])
  })

  it('sorts groups by date', () => {
    const rows = groupByDeadline([
      {
        cardId: 'c',
        benefitId: 'b1',
        benefitName: 'Later',
        merchantScope: null,
        cardLabel: 'Card',
        ownerInitial: 'A',
        period: { periodStart: d('2026-08-01'), periodEnd: d('2026-08-31'), isPartial: false },
        maxValue: 100,
        captured: 0,
        remaining: 100,
        daysLeft: 36,
        isAtRisk: false,
        needsEnrollment: false,
        isEstimated: false,
      },
      {
        cardId: 'c',
        benefitId: 'b2',
        benefitName: 'Sooner',
        merchantScope: null,
        cardLabel: 'Card',
        ownerInitial: 'A',
        period: { periodStart: d('2026-07-01'), periodEnd: d('2026-07-31'), isPartial: false },
        maxValue: 100,
        captured: 0,
        remaining: 100,
        daysLeft: 5,
        isAtRisk: true,
        needsEnrollment: false,
        isEstimated: false,
      },
    ])
    expect(rows.map((group) => group.periodEnd)).toEqual(['2026-07-31', '2026-08-31'])
  })

  it('carries the owner initial and card label for the row chip', () => {
    const model = buildDashboard(
      input({ cards: [card({ nickname: 'Everyday card', ownerDisplayName: 'Sam' })] }),
    )
    const row = model.deadlineGroups[0]!.rows[0]!
    expect(row.cardLabel).toBe('Everyday card')
    expect(row.ownerInitial).toBe('S')
  })

  it('falls back to the product name when a card has no nickname', () => {
    const model = buildDashboard(input())
    expect(model.deadlineGroups[0]!.rows[0]!.cardLabel).toBe('Example Premium Card')
  })

  it('shows partial usage on the row', () => {
    const model = buildDashboard(
      input({
        redemptions: [
          { userCardId: 'card-1', benefitId: 'monthly-credit', periodStart: d('2026-07-01'), amount: 500 },
        ],
      }),
    )
    const row = model.deadlineGroups[0]!.rows[0]!
    expect(row.captured).toBe(500)
    expect(row.remaining).toBe(1000)
    expect(row.maxValue).toBe(1500)
  })

  it('keeps an open-ended one_time offer out of the deadline groups', () => {
    const signup = benefit({
      id: 'signup',
      resetType: 'one_time',
      resetAnchor: 'card_open',
      maxValue: 50000,
    })
    const model = buildDashboard(input({ cards: [card({ benefits: [signup] })] }))
    // No deadline means it cannot be about to evaporate.
    expect(model.deadlineGroups).toEqual([])
    expect(model.valueAtRisk).toBe(0)
  })
})

describe('enrollment is the louder state — SPEC §6', () => {
  const gated = benefit({ id: 'gated', requiresEnrollment: true, maxValue: 5000 })

  it('flags an unenrolled period', () => {
    const model = buildDashboard(input({ cards: [card({ benefits: [gated] })] }))
    expect(model.deadlineGroups[0]!.rows[0]!.needsEnrollment).toBe(true)
  })

  it('clears the flag once enrolled for that period', () => {
    const model = buildDashboard(
      input({
        cards: [card({ benefits: [gated] })],
        enrollments: [
          { userCardId: 'card-1', benefitId: 'gated', periodStart: d('2026-07-01') },
        ],
      }),
    )
    expect(model.deadlineGroups[0]!.rows[0]!.needsEnrollment).toBe(false)
  })

  it('does not carry enrollment across periods', () => {
    const model = buildDashboard(
      input({
        cards: [card({ benefits: [gated] })],
        enrollments: [
          { userCardId: 'card-1', benefitId: 'gated', periodStart: d('2026-06-01') },
        ],
      }),
    )
    expect(model.deadlineGroups[0]!.rows[0]!.needsEnrollment).toBe(true)
  })

  it('still counts unenrolled value as at risk, since that is the point', () => {
    const model = buildDashboard(input({ cards: [card({ benefits: [gated] })] }))
    expect(model.valueAtRisk).toBe(5000)
  })
})

describe('cliff strip', () => {
  it('covers twelve months starting with the current one', () => {
    const model = buildDashboard(input())
    expect(model.cliffStrip).toHaveLength(12)
    expect(model.cliffStrip[0]!.month).toBe('2026-07-01')
    expect(model.cliffStrip[11]!.month).toBe('2027-06-01')
  })

  it('puts a monthly credit in every month', () => {
    const model = buildDashboard(input())
    expect(model.cliffStrip.every((month) => month.total === 1500)).toBe(true)
  })

  it('makes the December calendar-year cliff visible', () => {
    // Airline-style credit: calendar annual, dies Dec 31 (SPEC §6).
    const airline = benefit({
      id: 'airline',
      resetType: 'annual',
      resetAnchor: 'calendar',
      maxValue: 20000,
    })
    const model = buildDashboard(input({ cards: [card({ benefits: [airline] })] }))
    const december = model.cliffStrip.find((month) => month.month === '2026-12-01')!
    expect(december.total).toBe(20000)
    expect(december.count).toBe(1)
    expect(model.cliffStrip.filter((month) => month.total > 0)).toHaveLength(1)
  })

  it('stacks several benefits landing in the same month', () => {
    const airline = benefit({
      id: 'airline',
      resetType: 'annual',
      resetAnchor: 'calendar',
      maxValue: 20000,
    })
    const saks = benefit({
      id: 'saks',
      resetType: 'semiannual',
      resetAnchor: 'calendar',
      maxValue: 5000,
    })
    const model = buildDashboard(input({ cards: [card({ benefits: [airline, saks] })] }))
    const december = model.cliffStrip.find((month) => month.month === '2026-12-01')!
    expect(december.total).toBe(25000)
    expect(december.count).toBe(2)
  })

  it('is empty when nothing expires', () => {
    const strip = buildCliffStrip([], d('2026-07-26'))
    expect(strip).toHaveLength(12)
    expect(strip.every((month) => month.total === 0 && month.count === 0)).toBe(true)
  })
})

describe('ledger bar and card summaries', () => {
  it('reconciles the ledger bar across cards', () => {
    const second = card({ id: 'card-2', benefits: [benefit({ id: 'other', maxValue: 2500 })] })
    const model = buildDashboard(input({ cards: [card(), second] }))
    const bar = model.ledgerBar
    expect(bar.captured + bar.forfeited + bar.available).toBe(bar.potential)
  })

  it('reports excluded separately and never inside potential', () => {
    const model = buildDashboard(
      input({ cards: [card({ excludedBenefitIds: ['monthly-credit'] })] }),
    )
    expect(model.ledgerBar.potential).toBe(0)
    expect(model.excluded).toBeGreaterThan(0)
  })

  it('sums annual fees for open cards only', () => {
    const closed = card({ id: 'card-2', closedOn: d('2026-01-15'), annualFee: 39500 })
    const model = buildDashboard(input({ cards: [card(), closed] }))
    expect(model.totalAnnualFees).toBe(69500)
  })

  it('summarises each card with pace and fee recovery', () => {
    const model = buildDashboard(input())
    const summary = model.cards[0]!
    expect(summary.cardYear!.periodStart).toBe('2026-03-10')
    expect(summary.pace).toBe('behind')
    expect(summary.feeRecovery).toBe(-69500)
    expect(summary.atRiskCount).toBe(1)
    expect(summary.atRiskValue).toBe(1500)
  })

  it('handles a card with no current card year', () => {
    const closed = card({ closedOn: d('2025-01-01') })
    const model = buildDashboard(input({ cards: [closed] }))
    expect(model.cards[0]!.cardYear).toBeNull()
    expect(model.cards[0]!.pace).toBe('unknown')
    expect(model.ledgerBar.potential).toBe(0)
  })

  it('surfaces orphaned redemptions rather than hiding them', () => {
    const model = buildDashboard(
      input({
        redemptions: [
          { userCardId: 'card-1', benefitId: 'monthly-credit', periodStart: d('2026-07-15'), amount: 1200 },
        ],
      }),
    )
    expect(model.orphanedRedemptions).toEqual({ count: 1, amount: 1200 })
  })
})

describe('perks and exclusions never reach the action list', () => {
  it('skips perks', () => {
    const perk = benefit({ id: 'perk', benefitType: 'perk', maxValue: null })
    const model = buildDashboard(input({ cards: [card({ benefits: [perk] })] }))
    expect(model.deadlineGroups).toEqual([])
    expect(model.valueAtRisk).toBe(0)
  })

  it('skips excluded benefits', () => {
    const model = buildDashboard(
      input({ cards: [card({ excludedBenefitIds: ['monthly-credit'] })] }),
    )
    expect(model.deadlineGroups).toEqual([])
    expect(model.valueAtRisk).toBe(0)
  })

  it('skips periods after a card is closed', () => {
    const model = buildDashboard(input({ cards: [card({ closedOn: d('2026-07-10') })] }))
    expect(model.valueAtRisk).toBe(0)
  })
})

describe('§3.1 applies_to on the deadline list', () => {
  it('keeps a primary-only credit off an authorized user card', () => {
    const primaryOnly = benefit({ id: 'primary-only', appliesTo: 'primary' })
    const model = buildDashboard(
      input({ cards: [card({ isAuthorizedUser: true, benefits: [primaryOnly] })] }),
    )
    expect(model.valueAtRisk).toBe(0)
    expect(model.deadlineGroups).toEqual([])
  })

  it('keeps it on the primary cardholder card', () => {
    const primaryOnly = benefit({ id: 'primary-only', appliesTo: 'primary' })
    const model = buildDashboard(
      input({ cards: [card({ isAuthorizedUser: false, benefits: [primaryOnly] })] }),
    )
    expect(model.valueAtRisk).toBe(1500)
  })

  it('shows an authorized-user credit only on the authorized user card', () => {
    const auOnly = benefit({ id: 'au-only', appliesTo: 'authorized_user', maxValue: 2000 })
    const primary = card({ id: 'p', isAuthorizedUser: false, benefits: [auOnly] })
    const au = card({ id: 'a', isAuthorizedUser: true, benefits: [auOnly] })
    const model = buildDashboard(input({ cards: [primary, au] }))
    expect(model.valueAtRisk).toBe(2000)
    expect(model.deadlineGroups[0]!.rows.map((row) => row.cardId)).toEqual(['a'])
  })

  it('keeps it out of the cliff strip too', () => {
    const primaryOnly = benefit({ id: 'primary-only', appliesTo: 'primary' })
    const model = buildDashboard(
      input({ cards: [card({ isAuthorizedUser: true, benefits: [primaryOnly] })] }),
    )
    expect(model.cliffStrip.every((month) => month.total === 0)).toBe(true)
  })
})

describe('§4.6 estimated benefits in the deadline list', () => {
  const night = benefit({
    id: 'free-night',
    name: 'Free night',
    maxValue: 50000, // an estimate, not a cap
    valueMode: 'estimated',
    resetType: 'annual',
    resetAnchor: 'card_open',
  })
  // The certificate period runs 2026-03-10 → 2027-03-09; a week out, it is in the list.
  const asOf = d('2027-03-02')

  it('lists an unused certificate at its estimate, flagged as estimated', () => {
    const model = buildDashboard(input({ cards: [card({ benefits: [night] })], asOf }))
    const row = model.deadlineGroups.flatMap((group) => group.rows)[0]!
    expect(row.remaining).toBe(50000)
    expect(row.isEstimated).toBe(true)
  })

  it('drops the certificate once recorded, even for less than the estimate', () => {
    const model = buildDashboard(
      input({
        cards: [card({ benefits: [night] })],
        asOf,
        redemptions: [
          { userCardId: 'card-1', benefitId: 'free-night', periodStart: d('2026-03-10'), amount: 18000 },
        ],
      }),
    )
    expect(model.deadlineGroups.flatMap((group) => group.rows)).toEqual([])
  })
})

describe('later deadlines — beyond the 30-day window', () => {
  const quarterly = benefit({ id: 'quarterly-credit', name: 'Quarterly credit', resetType: 'quarterly' })

  it('shows each benefit once, at its current deadline, with nothing not yet started', () => {
    // asOf 2026-07-26: the July monthly period is at risk (5 days); Q3 ends Sep 30 (66 days).
    const model = buildDashboard(input({ cards: [card({ benefits: [benefit(), quarterly] })] }))
    expect(model.deadlineGroups.map((group) => group.periodEnd)).toEqual(['2026-07-31'])
    expect(model.laterGroups.map((group) => group.periodEnd)).toEqual(['2026-09-30'])
    expect(model.laterGroups[0]!.rows.map((row) => row.benefitId)).toEqual(['quarterly-credit'])
  })

  it('leaves out a later period that is already fully used', () => {
    const model = buildDashboard(
      input({
        cards: [card({ benefits: [quarterly] })],
        redemptions: [
          { userCardId: 'card-1', benefitId: 'quarterly-credit', periodStart: d('2026-07-01'), amount: 1500 },
        ],
      }),
    )
    expect(model.laterGroups).toEqual([])
  })
})
