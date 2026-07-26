/**
 * The period engine — SPEC §5.
 *
 * Pure functions. No database, no clock, no `Date`: `asOf` is always injected, and a lint
 * rule enforces it for this directory. Every boundary is a {@link PlainDate} evaluated in
 * the household's timezone by the caller (SPEC §5.4).
 *
 * The structural decision this file exists to protect: **periods are computed, never
 * materialized** (SPEC §3, §5). `periodStart` is the key other tables reference; it is
 * derived here every time rather than stored in a `benefit_periods` table.
 */

import {
  addDays,
  addMonths,
  compareDates,
  isAfter,
  isBefore,
  maxDate,
  minDate,
  plainDate,
  toParts,
  type PlainDate,
} from '@/lib/date/plain-date'
import {
  InvalidBenefitDefinitionError,
  type BenefitPeriod,
  type PeriodBenefit,
  type PeriodContext,
  type ResetType,
} from './types'

/**
 * Base period length in months for each reset type (SPEC §5.2).
 *
 * `reset_interval` multiplies these. `rolling` is years — its only spec example is Global
 * Entry at `reset_interval = 4` — so it shares the 12-month base with `annual`; the two
 * differ only in catalog intent, not arithmetic. `one_time` never resets and has no
 * length, so it takes a separate path entirely.
 */
const BASE_MONTHS: Record<Exclude<ResetType, 'one_time'>, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
  rolling: 12,
}

/** Guards against a malformed definition spinning the iteration in `periodsInRange`. */
const MAX_PERIODS = 10_000

interface CanonicalPeriod {
  readonly start: PlainDate
  readonly end: PlainDate
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

function assertValid(benefit: PeriodBenefit): void {
  const { resetInterval, resetType, effectiveFrom, effectiveTo } = benefit
  if (!Number.isInteger(resetInterval) || resetInterval < 1) {
    throw new InvalidBenefitDefinitionError(
      `reset_interval must be an integer >= 1, received ${String(resetInterval)}`,
    )
  }
  if (resetType !== 'one_time' && !(resetType in BASE_MONTHS)) {
    throw new InvalidBenefitDefinitionError(`unknown reset_type ${String(resetType)}`)
  }
  if (effectiveTo !== null && isBefore(effectiveTo, effectiveFrom)) {
    throw new InvalidBenefitDefinitionError(
      `effective_to ${effectiveTo} precedes effective_from ${effectiveFrom}`,
    )
  }
}

function monthsPerPeriod(benefit: PeriodBenefit): number {
  const base = BASE_MONTHS[benefit.resetType as Exclude<ResetType, 'one_time'>]
  return base * benefit.resetInterval
}

/* -------------------------------------------------------------------------- */
/* Bounds                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The window in which this benefit can have periods at all: the card's life intersected
 * with the benefit's effective window. Null when those don't overlap.
 */
function bounds(
  benefit: PeriodBenefit,
  cardOpenedOn: PlainDate,
  context: PeriodContext,
): { lower: PlainDate; upper: PlainDate | null } | null {
  const lower = maxDate(cardOpenedOn, benefit.effectiveFrom)

  const closesAt = [benefit.effectiveTo, context.cardClosedOn].filter(
    (d): d is PlainDate => d !== null && d !== undefined,
  )
  const upper = closesAt.length === 0 ? null : closesAt.reduce(minDate)

  if (upper !== null && isBefore(upper, lower)) return null
  return { lower, upper }
}

/* -------------------------------------------------------------------------- */
/* Canonical (unclamped) period arithmetic                                    */
/* -------------------------------------------------------------------------- */

function absoluteMonth(date: PlainDate): number {
  const { year, month } = toParts(date)
  return year * 12 + (month - 1)
}

function firstDayOfAbsoluteMonth(absMonth: number): PlainDate {
  return plainDate(Math.floor(absMonth / 12), (((absMonth % 12) + 12) % 12) + 1, 1)
}

/**
 * Calendar-anchored period containing `target`.
 *
 * Aligned to the Jan 1 epoch, so every household sees identical boundaries for the same
 * benefit — that is what `reset_anchor = 'calendar'` means. Intervals that divide 12
 * (monthly, quarterly, semiannual, annual) therefore land on the boundaries issuers
 * actually publish: quarters on Jan/Apr/Jul/Oct, semiannual on Jan–Jun / Jul–Dec, annual
 * dying Dec 31 (SPEC §5.2).
 */
function calendarPeriodContaining(target: PlainDate, months: number): CanonicalPeriod {
  const index = Math.floor(absoluteMonth(target) / months)
  const startMonth = index * months
  return {
    start: firstDayOfAbsoluteMonth(startMonth),
    end: addDays(firstDayOfAbsoluteMonth(startMonth + months), -1),
  }
}

/**
 * Card-open-anchored period containing `target`.
 *
 * Boundaries are always measured from the original anchor rather than from the previous
 * boundary, which is what keeps a card opened on the 31st from drifting: Jan 31 → Feb 28
 * → Mar 31, not Mar 28. Day-of-month overflow is clamped by `addMonths`, which is also
 * what makes a Feb 29 anniversary land on Feb 28 in non-leap years (SPEC §5.3).
 */
function anchoredPeriodContaining(
  target: PlainDate,
  anchor: PlainDate,
  months: number,
): CanonicalPeriod {
  let index = Math.floor((absoluteMonth(target) - absoluteMonth(anchor)) / months)

  // Day-of-month clamping can put the estimate one period off in either direction.
  let guard = 0
  while (isAfter(addMonths(anchor, index * months), target)) {
    index -= 1
    if (++guard > 4) throw new Error('Failed to locate anchored period')
  }
  while (!isAfter(addMonths(anchor, (index + 1) * months), target)) {
    index += 1
    if (++guard > 4) throw new Error('Failed to locate anchored period')
  }

  return {
    start: addMonths(anchor, index * months),
    end: addDays(addMonths(anchor, (index + 1) * months), -1),
  }
}

function canonicalPeriodContaining(
  benefit: PeriodBenefit,
  cardOpenedOn: PlainDate,
  target: PlainDate,
): CanonicalPeriod {
  const months = monthsPerPeriod(benefit)
  return benefit.resetAnchor === 'calendar'
    ? calendarPeriodContaining(target, months)
    : anchoredPeriodContaining(target, cardOpenedOn, months)
}

function nextCanonicalPeriod(
  benefit: PeriodBenefit,
  cardOpenedOn: PlainDate,
  current: CanonicalPeriod,
): CanonicalPeriod {
  return canonicalPeriodContaining(benefit, cardOpenedOn, addDays(current.end, 1))
}

/* -------------------------------------------------------------------------- */
/* Clamping                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Clamp a canonical period to the card's life and the benefit's effective window.
 *
 * A card opened mid-period keeps a short first period rather than skipping it, and a
 * benefit whose `effective_to` falls mid-period keeps a truncated final period. Both
 * still count full `max_value` — issuers don't prorate (SPEC §5.3).
 */
function clamp(
  period: CanonicalPeriod,
  lower: PlainDate,
  upper: PlainDate | null,
): BenefitPeriod | null {
  const start = maxDate(period.start, lower)
  const end = upper === null ? period.end : minDate(period.end, upper)
  if (isBefore(end, start)) return null
  return {
    periodStart: start,
    periodEnd: end,
    isPartial: start !== period.start || end !== period.end,
  }
}

/** The single open-ended period of a `one_time` benefit. */
function oneTimePeriod(lower: PlainDate, upper: PlainDate | null): BenefitPeriod {
  return { periodStart: lower, periodEnd: upper, isPartial: false }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The period of `benefit` that contains `asOf`, or null when none does.
 *
 * Returns null when the card was not yet open, was already closed, the benefit was not
 * yet or is no longer effective, or a `one_time` benefit has already been redeemed
 * (SPEC §5.3).
 *
 * @param benefit      Reset rules and effective window
 * @param cardOpenedOn `user_cards.opened_on` — anchors cardmember-year periods
 * @param asOf         Injected calendar date, resolved in the household timezone
 * @param context      Household timezone plus card closure and one-time redemption state
 */
export function periodFor(
  benefit: PeriodBenefit,
  cardOpenedOn: PlainDate,
  asOf: PlainDate,
  context: PeriodContext,
): BenefitPeriod | null {
  assertValid(benefit)

  if (benefit.resetType === 'one_time' && context.oneTimeRedeemed === true) return null

  const window = bounds(benefit, cardOpenedOn, context)
  if (window === null) return null
  if (isBefore(asOf, window.lower)) return null
  if (window.upper !== null && isAfter(asOf, window.upper)) return null

  if (benefit.resetType === 'one_time') {
    return oneTimePeriod(window.lower, window.upper)
  }

  return clamp(
    canonicalPeriodContaining(benefit, cardOpenedOn, asOf),
    window.lower,
    window.upper,
  )
}

/**
 * Every period of `benefit` that overlaps the inclusive range `from`..`to`.
 *
 * Boundaries are clamped by the card's life and the benefit's effective window, but
 * **not** by the query range: a period straddling `to` is returned with its true end, so
 * callers can tell whether it has closed. Ordered by `periodStart`.
 *
 * Note this is overlap, not containment — SPEC §4 sums "every period falling in the card
 * year", and a period straddling the card-year boundary belongs to that year's figures.
 */
export function periodsInRange(
  benefit: PeriodBenefit,
  cardOpenedOn: PlainDate,
  from: PlainDate,
  to: PlainDate,
  context: PeriodContext,
): BenefitPeriod[] {
  assertValid(benefit)
  if (isBefore(to, from)) return []

  if (benefit.resetType === 'one_time' && context.oneTimeRedeemed === true) return []

  const window = bounds(benefit, cardOpenedOn, context)
  if (window === null) return []

  const rangeStart = maxDate(from, window.lower)
  const rangeEnd = window.upper === null ? to : minDate(to, window.upper)
  if (isBefore(rangeEnd, rangeStart)) return []

  if (benefit.resetType === 'one_time') {
    return [oneTimePeriod(window.lower, window.upper)]
  }

  const periods: BenefitPeriod[] = []
  let canonical = canonicalPeriodContaining(benefit, cardOpenedOn, rangeStart)

  for (let i = 0; i <= MAX_PERIODS; i += 1) {
    if (isAfter(canonical.start, rangeEnd)) break
    if (i === MAX_PERIODS) {
      throw new InvalidBenefitDefinitionError(
        `range ${from}..${to} yields more than ${MAX_PERIODS} periods`,
      )
    }
    const clamped = clamp(canonical, window.lower, window.upper)
    if (clamped !== null) periods.push(clamped)
    canonical = nextCanonicalPeriod(benefit, cardOpenedOn, canonical)
  }

  return periods
}

/* -------------------------------------------------------------------------- */
/* Helpers for consumers (ledger, dashboard)                                  */
/* -------------------------------------------------------------------------- */

/**
 * Whether a period has closed as of `asOf` — the condition under which unredeemed value
 * becomes `forfeited` (SPEC §4). An open-ended `one_time` period never closes.
 */
export function isPeriodClosed(period: BenefitPeriod, asOf: PlainDate): boolean {
  return period.periodEnd !== null && isAfter(asOf, period.periodEnd)
}

/** The key to write to `redemptions.period_start` / `enrollments.period_start`. */
export function periodKey(period: BenefitPeriod): PlainDate {
  return period.periodStart
}

/** Sorts periods by start date, ascending. */
export function comparePeriods(a: BenefitPeriod, b: BenefitPeriod): number {
  return compareDates(a.periodStart, b.periodStart)
}
