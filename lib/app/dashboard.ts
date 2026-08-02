/**
 * Dashboard view model — SPEC §6.
 *
 * Pure functions over already-loaded data, with `asOf` injected. Everything the deadline
 * view shows is computed here so it can be tested without a database or a browser: value at
 * risk, the nearest cliff, the ledger bar, the twelve-month cliff strip, and the deadline
 * groups.
 *
 * Job 1 in §1 is "tell me what money is about to evaporate", so the organising unit is a
 * *period about to close*, not a card and not a benefit.
 */

import {
  addDays,
  addMonths,
  differenceInDays,
  endOfMonth,
  startOfMonth,
  type PlainDate,
} from '@/lib/date/plain-date'
import {
  isPeriodClosed,
  periodsInRange,
  type BenefitPeriod,
  type PeriodContext,
} from '@/lib/periods'
import {
  benefitAppliesToCard,
  ledgerForCardYear,
  sumTotals,
  type LedgerBenefit,
  type LedgerTotals,
} from '@/lib/ledger'

/** Horizon for "about to evaporate" (SPEC §6: periods closing within 30 days). */
export const AT_RISK_DAYS = 30

export interface DashboardCard {
  readonly id: string
  readonly productName: string
  readonly nickname: string | null
  readonly ownerDisplayName: string
  readonly openedOn: PlainDate
  readonly closedOn?: PlainDate | undefined
  readonly annualFee: number
  readonly isAuthorizedUser: boolean
  readonly benefits: readonly DashboardBenefit[]
  readonly excludedBenefitIds: readonly string[]
}

export interface DashboardBenefit extends LedgerBenefit {
  readonly name: string
  readonly merchantScope: string | null
  /** Shown wherever an estimated value is used, so a figure is never silently a guess. */
  readonly estimateBasis?: string | null | undefined
}

export interface DashboardInput {
  readonly cards: readonly DashboardCard[]
  readonly redemptions: readonly {
    readonly userCardId: string
    readonly benefitId: string
    readonly periodStart: PlainDate
    readonly amount: number
  }[]
  readonly enrollments: readonly {
    readonly userCardId: string
    readonly benefitId: string
    readonly periodStart: PlainDate
  }[]
  readonly asOf: PlainDate
  readonly tz: string
}

/** One actionable row: a benefit period that is open and has value left. */
export interface DeadlineRow {
  readonly cardId: string
  readonly benefitId: string
  readonly benefitName: string
  readonly merchantScope: string | null
  readonly cardLabel: string
  readonly ownerInitial: string
  readonly period: BenefitPeriod
  readonly maxValue: number
  readonly captured: number
  /** What is still claimable. The figure the row leads with. */
  readonly remaining: number
  readonly daysLeft: number
  readonly isAtRisk: boolean
  /**
   * An unenrolled credit is worth $0 regardless of intent, so this is a louder state than
   * unused and its action is "Enroll", not "Mark used" (SPEC §6).
   */
  readonly needsEnrollment: boolean
}

/** Rows sharing a deadline, soonest first (SPEC §6 deadline groups). */
export interface DeadlineGroup {
  readonly periodEnd: PlainDate
  readonly daysLeft: number
  readonly total: number
  readonly rows: readonly DeadlineRow[]
}

export interface CliffMonth {
  /** First day of the month, for keying and labelling. */
  readonly month: PlainDate
  readonly total: number
  readonly count: number
}

export interface Cliff {
  readonly date: PlainDate
  readonly amount: number
  readonly count: number
}

export interface CardSummary {
  readonly card: DashboardCard
  readonly totals: LedgerTotals
  readonly cardYear: BenefitPeriod | null
  readonly capturedRatio: number | null
  readonly elapsedRatio: number
  readonly pace: 'ahead' | 'behind' | 'unknown'
  readonly feeRecovery: number
  readonly atRiskCount: number
  readonly atRiskValue: number
}

export interface DashboardModel {
  readonly asOf: PlainDate
  /** Hero: unclaimed value in periods closing within 30 days. */
  readonly valueAtRisk: number
  readonly nearestCliff: Cliff | null
  readonly ledgerBar: LedgerTotals
  readonly excluded: number
  readonly totalAnnualFees: number
  readonly cliffStrip: readonly CliffMonth[]
  readonly deadlineGroups: readonly DeadlineGroup[]
  readonly cards: readonly CardSummary[]
  readonly orphanedRedemptions: { readonly count: number; readonly amount: number }
  /**
   * Value gated behind a spend threshold (SPEC §4.7). Shown as its own thing — never in
   * the hero or the four-way split, because it is not value you can simply go and claim.
   */
  readonly unlockable: readonly UnlockableItem[]
  /** Per-use benefits worth nudging repeat use of (SPEC §4.8). */
  readonly repeatable: readonly RepeatableItem[]
}

export interface RepeatableItem {
  readonly cardId: string
  readonly benefitId: string
  readonly benefitName: string
  readonly cardLabel: string
  readonly ownerInitial: string
  readonly perUseCap: number
  readonly captured: number
  readonly uses: number
}

export interface UnlockableItem {
  readonly cardId: string
  readonly benefitId: string
  readonly benefitName: string
  readonly cardLabel: string
  readonly ownerInitial: string
  readonly value: number
  readonly unlockSpend: number
  readonly isEstimated: boolean
  readonly periodEnd: PlainDate | null
}

function cardLabel(card: DashboardCard): string {
  return card.nickname ?? card.productName
}

function initialOf(displayName: string): string {
  return (displayName.trim()[0] ?? '?').toUpperCase()
}

function key(userCardId: string, benefitId: string, periodStart: PlainDate): string {
  return `${userCardId} ${benefitId} ${periodStart}`
}

/**
 * Every open period with value left, across every card, within `horizonDays`.
 *
 * Looks forward far enough to fill the cliff strip, so a single pass feeds both the
 * deadline groups and the twelve-month view.
 */
function collectRows(input: DashboardInput, horizonDays: number): DeadlineRow[] {
  const { asOf, tz } = input

  const redeemed = new Map<string, number>()
  for (const redemption of input.redemptions) {
    const mapKey = key(redemption.userCardId, redemption.benefitId, redemption.periodStart)
    redeemed.set(mapKey, (redeemed.get(mapKey) ?? 0) + redemption.amount)
  }
  const enrolled = new Set(
    input.enrollments.map((e) => key(e.userCardId, e.benefitId, e.periodStart)),
  )

  const horizonEnd = addDays(asOf, horizonDays)
  const rows: DeadlineRow[] = []

  for (const card of input.cards) {
    const context: PeriodContext = { tz, cardClosedOn: card.closedOn }
    const excluded = new Set(card.excludedBenefitIds)

    for (const benefit of card.benefits) {
      if (benefit.benefitType !== 'credit') continue
      if (excluded.has(benefit.id)) continue
      // A primary-only credit does not exist on an authorized user card (SPEC §3.1).
      if (!benefitAppliesToCard(benefit.appliesTo, card.isAuthorizedUser)) continue
      // Spend-gated value is not "about to evaporate" — it is not claimable yet (§4.7).
      if (benefit.unlockSpend != null) continue
      // A per-use benefit has no fixed allowance, so nothing about it expires (§4.8).
      if (benefit.repeatable === true) continue

      const maxValue = benefit.maxValue ?? 0

      for (const period of periodsInRange(benefit, card.openedOn, asOf, horizonEnd, context)) {
        // Closed periods are history: they belong to `forfeited`, not to an action list.
        if (isPeriodClosed(period, asOf)) continue

        const mapKey = key(card.id, benefit.id, period.periodStart)
        const captured = Math.min(redeemed.get(mapKey) ?? 0, maxValue)
        const remaining = maxValue - captured
        if (remaining <= 0) continue

        const daysLeft =
          period.periodEnd === null ? Number.POSITIVE_INFINITY : differenceInDays(asOf, period.periodEnd)

        rows.push({
          cardId: card.id,
          benefitId: benefit.id,
          benefitName: benefit.name,
          merchantScope: benefit.merchantScope,
          cardLabel: cardLabel(card),
          ownerInitial: initialOf(card.ownerDisplayName),
          period,
          maxValue,
          captured,
          remaining,
          daysLeft,
          isAtRisk: daysLeft <= AT_RISK_DAYS,
          needsEnrollment: benefit.requiresEnrollment && !enrolled.has(mapKey),
        })
      }
    }
  }

  return rows
}

/** Group at-risk rows by deadline, soonest first (SPEC §6). */
export function groupByDeadline(rows: readonly DeadlineRow[]): DeadlineGroup[] {
  const groups = new Map<string, DeadlineRow[]>()

  for (const row of rows) {
    // An open-ended one_time offer has no deadline, so it belongs in no deadline group.
    if (row.period.periodEnd === null) continue
    const existing = groups.get(row.period.periodEnd)
    if (existing) existing.push(row)
    else groups.set(row.period.periodEnd, [row])
  }

  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([periodEnd, groupRows]) => ({
      periodEnd: periodEnd as PlainDate,
      daysLeft: groupRows[0]!.daysLeft,
      total: groupRows.reduce((sum, row) => sum + row.remaining, 0),
      // Largest amount first inside a group: the biggest thing at stake reads first.
      rows: [...groupRows].sort((a, b) => b.remaining - a.remaining),
    }))
}

/** Twelve months forward, value expiring per month (SPEC §6 cliff strip). */
export function buildCliffStrip(
  rows: readonly DeadlineRow[],
  asOf: PlainDate,
  months = 12,
): CliffMonth[] {
  const buckets: CliffMonth[] = []

  for (let index = 0; index < months; index += 1) {
    const month = startOfMonth(addMonths(asOf, index))
    const monthEnd = endOfMonth(month)
    let total = 0
    let count = 0

    for (const row of rows) {
      const end = row.period.periodEnd
      if (end === null) continue
      if (end >= month && end <= monthEnd) {
        total += row.remaining
        count += 1
      }
    }

    buckets.push({ month, total, count })
  }

  return buckets
}

/** The whole deadline view. */
export function buildDashboard(input: DashboardInput): DashboardModel {
  const { asOf, tz } = input

  // A 12-month horizon covers the cliff strip; the deadline groups slice the near end.
  const horizonDays = differenceInDays(asOf, addMonths(asOf, 12))
  const rows = collectRows(input, horizonDays)
  const atRisk = rows.filter((row) => row.isAtRisk)

  const valueAtRisk = atRisk.reduce((sum, row) => sum + row.remaining, 0)

  const cardSummaries: CardSummary[] = []
  const unlockable: UnlockableItem[] = []
  const repeatable: RepeatableItem[] = []
  let excluded = 0
  let orphanCount = 0
  let orphanAmount = 0

  for (const card of input.cards) {
    const ledger = ledgerForCardYear({
      card: {
        openedOn: card.openedOn,
        closedOn: card.closedOn,
        annualFee: card.annualFee,
        isAuthorizedUser: card.isAuthorizedUser,
      },
      benefits: card.benefits,
      redemptions: input.redemptions
        .filter((r) => r.userCardId === card.id)
        .map((r) => ({ benefitId: r.benefitId, periodStart: r.periodStart, amount: r.amount })),
      enrollments: input.enrollments
        .filter((e) => e.userCardId === card.id)
        .map((e) => ({ benefitId: e.benefitId, periodStart: e.periodStart })),
      exclusions: card.excludedBenefitIds,
      asOf,
      tz,
    })

    const cardRows = atRisk.filter((row) => row.cardId === card.id)

    if (ledger === null) {
      cardSummaries.push({
        card,
        totals: sumTotals([]),
        cardYear: null,
        capturedRatio: null,
        elapsedRatio: 0,
        pace: 'unknown',
        feeRecovery: -card.annualFee,
        atRiskCount: cardRows.length,
        atRiskValue: cardRows.reduce((sum, row) => sum + row.remaining, 0),
      })
      continue
    }

    excluded += ledger.excluded
    orphanCount += ledger.orphanedRedemptions.count
    orphanAmount += ledger.orphanedRedemptions.amount

    for (const repeat of ledger.repeatableRows) {
      const definition = card.benefits.find((entry) => entry.id === repeat.benefitId)
      repeatable.push({
        cardId: card.id,
        benefitId: repeat.benefitId,
        benefitName: definition?.name ?? repeat.benefitId,
        cardLabel: cardLabel(card),
        ownerInitial: initialOf(card.ownerDisplayName),
        perUseCap: repeat.perUseCap,
        captured: repeat.captured,
        uses: repeat.uses,
      })
    }

    for (const locked of ledger.unlockableRows) {
      const definition = card.benefits.find((entry) => entry.id === locked.benefitId)
      unlockable.push({
        cardId: card.id,
        benefitId: locked.benefitId,
        benefitName: definition?.name ?? locked.benefitId,
        cardLabel: cardLabel(card),
        ownerInitial: initialOf(card.ownerDisplayName),
        value: locked.value,
        unlockSpend: locked.unlockSpend,
        isEstimated: locked.isEstimated,
        periodEnd: locked.period.periodEnd,
      })
    }

    cardSummaries.push({
      card,
      totals: ledger.totals,
      cardYear: ledger.cardYear,
      capturedRatio: ledger.capturePace.capturedRatio,
      elapsedRatio: ledger.capturePace.elapsedRatio,
      pace: ledger.capturePace.status,
      feeRecovery: ledger.feeRecovery,
      atRiskCount: cardRows.length,
      atRiskValue: cardRows.reduce((sum, row) => sum + row.remaining, 0),
    })
  }

  const groups = groupByDeadline(atRisk)
  const nearest = groups[0]

  return {
    asOf,
    valueAtRisk,
    nearestCliff:
      nearest === undefined
        ? null
        : { date: nearest.periodEnd, amount: nearest.total, count: nearest.rows.length },
    ledgerBar: sumTotals(cardSummaries.map((summary) => summary.totals)),
    excluded,
    totalAnnualFees: input.cards
      .filter((card) => card.closedOn === undefined)
      .reduce((sum, card) => sum + card.annualFee, 0),
    cliffStrip: buildCliffStrip(rows, asOf),
    deadlineGroups: groups,
    cards: cardSummaries,
    orphanedRedemptions: { count: orphanCount, amount: orphanAmount },
    unlockable: unlockable.sort((a, b) => b.value - a.value),
    repeatable: repeatable.sort((a, b) => b.perUseCap - a.perUseCap),
  }
}
