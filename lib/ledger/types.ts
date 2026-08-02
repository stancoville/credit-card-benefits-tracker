/**
 * Types for the ledger math (SPEC §4).
 *
 * Like the period engine, this module takes only the fields it needs, so it can be driven
 * from DB rows or from test fixtures and never touches a database. Every amount is integer
 * cents (CLAUDE.md hard rule 1); the only non-integers here are the two capture-pace
 * ratios, which are not money.
 */

import type { PlainDate } from '@/lib/date/plain-date'
import type { BenefitPeriod, PeriodBenefit } from '@/lib/periods'
import type { AppliesTo, BenefitType, ValueMode } from '@/db/schema'

/** A benefit definition plus the fields ledger math needs. Satisfied by a `benefits` row. */
export interface LedgerBenefit extends PeriodBenefit {
  readonly id: string
  /** Only `credit` participates (hard rule 7). Perks are skipped entirely. */
  readonly benefitType: BenefitType
  /** Integer cents. Null for perks. */
  readonly maxValue: number | null
  readonly requiresEnrollment: boolean
  /**
   * Who the benefit reaches (SPEC §3.1). A `primary` credit does not exist on an authorized
   * user card, so counting it would inflate `potential` with money nobody can claim.
   */
  readonly appliesTo: AppliesTo
  /**
   * `fixed` caps value at `maxValue`. `estimated` means the value is realized at
   * redemption — `maxValue` is only a planning default until then (SPEC §4.6).
   */
  readonly valueMode?: ValueMode | undefined
  /**
   * Qualifying spend required before this benefit's value exists (SPEC §4.7). Null or
   * omitted means unconditional.
   */
  readonly unlockSpend?: number | null | undefined
  /**
   * True when `maxValue` is a per-use cap and the benefit can be claimed repeatedly within
   * its period (SPEC §4.8). Such a benefit has no fixed allowance to forfeit.
   */
  readonly repeatable?: boolean | undefined
}

export interface LedgerRedemption {
  readonly benefitId: string
  /** The computed period key this redemption was filed under. */
  readonly periodStart: PlainDate
  /** Integer cents. */
  readonly amount: number
}

export interface LedgerEnrollment {
  readonly benefitId: string
  readonly periodStart: PlainDate
}

export interface LedgerCard {
  readonly openedOn: PlainDate
  readonly closedOn?: PlainDate | undefined
  /** Integer cents, with `annual_fee_override` already applied by the caller. */
  readonly annualFee: number
  /** Decides which `applies_to` benefits reach this card. Defaults to false. */
  readonly isAuthorizedUser?: boolean | undefined
}

export interface LedgerInput {
  readonly card: LedgerCard
  readonly benefits: readonly LedgerBenefit[]
  readonly redemptions: readonly LedgerRedemption[]
  readonly enrollments: readonly LedgerEnrollment[]
  /** Benefit ids in `benefit_exclusions` for this card. */
  readonly exclusions?: readonly string[] | undefined
  /** Injected calendar date in the household timezone (SPEC §5.4). */
  readonly asOf: PlainDate
  readonly tz: string
}

/** One computed period of one benefit, with its money split four ways. */
export interface LedgerRow {
  readonly benefitId: string
  readonly period: BenefitPeriod
  /** Integer cents. Counted in full even for a partial period — issuers don't prorate. */
  readonly maxValue: number
  readonly captured: number
  readonly forfeited: number
  readonly available: number
  readonly isClosed: boolean
  /** True when the benefit needs no enrollment, or is enrolled for this period. */
  readonly isEnrolled: boolean
  readonly requiresEnrollment: boolean
  /** True when this benefit's value is realized at redemption (SPEC §4.6). */
  readonly isEstimated: boolean
  /**
   * True when the figures above rest on the catalog's estimate rather than a value the
   * household actually recorded. Every total touching one of these must say so.
   */
  readonly usedEstimate: boolean
}

export interface LedgerTotals {
  readonly potential: number
  readonly captured: number
  readonly forfeited: number
  readonly available: number
  /** `available` split for display (SPEC §4.2). The two sum to `available`. */
  readonly availableEnrolled: number
  /** An unenrolled credit is worth $0 until enrolled — the louder state in §6. */
  readonly availableNotEnrolled: number
  /**
   * The portion of `potential` that rests on an estimate rather than a realized or capped
   * amount. Never hidden: a total containing this must be labelled as including estimates
   * (SPEC §4.6).
   */
  readonly estimated: number
  /**
   * Value that exists but is gated behind a spend threshold and has not been claimed
   * (SPEC §4.7). Reported alongside `potential`, never inside it — the same treatment
   * `excluded` gets, and for the same reason: the four-way split has to stay trustworthy.
   */
  readonly unlockable: number
}

/** Ratios, not money. Compared to decide the ahead/behind colour in §6. */
export interface CapturePace {
  /** `captured / potential`, or null when `potential` is 0. */
  readonly capturedRatio: number | null
  /** Elapsed fraction of the card year. */
  readonly elapsedRatio: number
  readonly status: 'ahead' | 'behind' | 'unknown'
}

/** A benefit that pays out per use rather than per period (SPEC §4.8). */
export interface RepeatableRow {
  readonly benefitId: string
  readonly period: BenefitPeriod
  /** The most one use can pay out. */
  readonly perUseCap: number
  /** What has actually been captured in this period so far. */
  readonly captured: number
  /** How many redemptions have been recorded in this period. */
  readonly uses: number
}

/** A period whose value is real but still locked behind a spend threshold (SPEC §4.7). */
export interface UnlockableRow {
  readonly benefitId: string
  readonly period: BenefitPeriod
  /** What unlocking it would be worth. */
  readonly value: number
  /** Qualifying spend needed inside this period. */
  readonly unlockSpend: number
  /** True when `value` rests on a catalog estimate rather than a fixed amount. */
  readonly isEstimated: boolean
}

export interface CardYearLedger {
  readonly cardYear: BenefitPeriod
  readonly rows: readonly LedgerRow[]
  /** Not included in `rows` — these contribute to `unlockable`, not to `potential`. */
  readonly unlockableRows: readonly UnlockableRow[]
  /**
   * Per-use benefits (SPEC §4.8). Their captured value *is* in `rows` and `potential`;
   * this list exists so the UI can show the per-use cap and nudge repeat use.
   */
  readonly repeatableRows: readonly RepeatableRow[]
  readonly totals: LedgerTotals
  /**
   * Σ `max_value` over periods of excluded benefits. Reported separately and never folded
   * into `potential` — showing it openly is what keeps the number trustworthy (SPEC §4).
   */
  readonly excluded: number
  /**
   * Redemptions whose `period_start` matches no computed period, usually because
   * `opened_on` was edited after they were written. Surfaced rather than silently dropped:
   * they are excluded from `captured`, so without this they would just vanish.
   */
  readonly orphanedRedemptions: {
    readonly count: number
    readonly amount: number
  }
  /** `captured − annualFee`. A drill-in figure, never a dashboard figure (SPEC §4). */
  readonly feeRecovery: number
  readonly capturePace: CapturePace
}
