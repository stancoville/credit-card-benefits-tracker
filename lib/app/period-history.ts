/**
 * How a credit's periods are presented on the card drill-in: grouped by cadence, and laid
 * out period by period so someone who skipped a few months can reconcile them (SPEC §4.3,
 * §6).
 *
 * Pure. It reads the ledger's rows rather than recomputing periods, so the grid and the
 * four-way totals above it can never disagree about which periods exist or what's in them.
 */

import type { ResetAnchor, ResetType } from '@/db/schema'
import { getYear, isAfter, toParts, type PlainDate } from '@/lib/date/plain-date'
import type { LedgerRow } from '@/lib/ledger'

/* -------------------------------------------------------------------------- */
/* Cadence                                                                    */
/* -------------------------------------------------------------------------- */

export type Cadence =
  'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'multi_year' | 'one_time' | 'other'

/** Display order and section headings, shortest cycle first. */
export const CADENCES: readonly { cadence: Cadence; heading: string }[] = [
  { cadence: 'monthly', heading: 'Monthly' },
  { cadence: 'quarterly', heading: 'Quarterly' },
  { cadence: 'semiannual', heading: 'Twice a year' },
  { cadence: 'annual', heading: 'Once a year' },
  { cadence: 'multi_year', heading: 'Every few years' },
  { cadence: 'one_time', heading: 'One-time' },
  { cadence: 'other', heading: 'Other' },
]

export interface CadenceBenefit {
  readonly resetType: ResetType
  readonly resetInterval: number
}

/**
 * What a person would call the cycle. `monthly ×3` *is* quarterly and `monthly ×6` is
 * twice a year, whatever the catalog's spelling; `rolling ×4` is Global Entry's every four
 * years.
 */
export function cadenceOf(benefit: CadenceBenefit): Cadence {
  const { resetType, resetInterval: n } = benefit
  if (resetType === 'one_time') return 'one_time'
  const months =
    resetType === 'monthly'
      ? n
      : resetType === 'quarterly'
        ? 3 * n
        : resetType === 'semiannual'
          ? 6 * n
          : 12 * n // annual and rolling are both counted in years
  if (months === 1) return 'monthly'
  if (months === 3) return 'quarterly'
  if (months === 6) return 'semiannual'
  if (months === 12) return 'annual'
  if (months > 12 && months % 12 === 0) return 'multi_year'
  return 'other'
}

/** Cadences whose card year holds several periods, so a period grid is worth showing. */
export function hasPeriodGrid(cadence: Cadence): boolean {
  return cadence === 'monthly' || cadence === 'quarterly' || cadence === 'semiannual'
}

/* -------------------------------------------------------------------------- */
/* Period chips                                                               */
/* -------------------------------------------------------------------------- */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

function month(date: PlainDate): string {
  return MONTHS[toParts(date).month - 1] as string
}

function fullDate(date: PlainDate): string {
  const { year, day } = toParts(date)
  return `${month(date)} ${day}, ${year}`
}

/**
 * - `used` — captured the full value
 * - `partial` — some captured; if closed, the rest was forfeited
 * - `missed` — closed with nothing captured: forfeited
 * - `open` — the current period, not yet fully used
 * - `upcoming` — hasn't started; nothing to mark yet
 */
export type ChipStatus = 'used' | 'partial' | 'missed' | 'open' | 'upcoming'

export interface PeriodChip {
  readonly periodStart: PlainDate
  readonly periodEnd: PlainDate | null
  /** Short label: `Mar`, `Q2`, `Jan–Jun`. */
  readonly label: string
  /** The year, shown on the first chip and wherever the year changes. */
  readonly yearLabel: string | null
  /** For the accessible name: `Mar 1, 2026 – Mar 31, 2026`. */
  readonly rangeLabel: string
  readonly status: ChipStatus
  readonly captured: number
  readonly maxValue: number
  /**
   * The date to record a "Mark used" against. A closed period uses its last day, the open
   * period uses today. Either way `periodFor` maps it back into this period (SPEC §4.3).
   */
  readonly markOn: PlainDate | null
}

function shortLabel(
  cadence: Cadence,
  anchor: ResetAnchor,
  start: PlainDate,
  end: PlainDate | null,
): string {
  const startMonth = toParts(start).month
  if (cadence === 'quarterly' && anchor === 'calendar') {
    return `Q${Math.floor((startMonth - 1) / 3) + 1}`
  }
  if (cadence === 'monthly' || end === null || month(start) === month(end)) return month(start)
  return `${month(start)}–${month(end)}`
}

export function periodChips(
  rows: readonly LedgerRow[],
  cadence: Cadence,
  anchor: ResetAnchor,
  asOf: PlainDate,
): PeriodChip[] {
  const sorted = [...rows].sort((a, b) => (a.period.periodStart < b.period.periodStart ? -1 : 1))
  let previousYear: number | null = null

  return sorted.map((row) => {
    const { periodStart, periodEnd } = row.period
    const started = !isAfter(periodStart, asOf)
    const status: ChipStatus = !started
      ? 'upcoming'
      : row.captured >= row.maxValue
        ? 'used'
        : row.captured > 0
          ? 'partial'
          : row.isClosed
            ? 'missed'
            : 'open'

    const year = getYear(periodStart)
    const yearLabel = year === previousYear ? null : String(year)
    previousYear = year

    return {
      periodStart,
      periodEnd,
      label: shortLabel(cadence, anchor, periodStart, periodEnd),
      yearLabel,
      rangeLabel: `${fullDate(periodStart)} – ${periodEnd ? fullDate(periodEnd) : 'no end'}`,
      status,
      captured: row.captured,
      maxValue: row.maxValue,
      markOn: !started ? null : row.isClosed && periodEnd !== null ? periodEnd : asOf,
    }
  })
}

/* -------------------------------------------------------------------------- */
/* Reset summary                                                              */
/* -------------------------------------------------------------------------- */

function ordinal(day: number): string {
  const suffix =
    day % 100 >= 11 && day % 100 <= 13
      ? 'th'
      : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th')
  return `${day}${suffix}`
}

/**
 * When the credit resets, in words: "Resets Jan 1 and Jul 1" reads at a glance where
 * "semiannual · calendar" doesn't.
 */
export function resetSummary(
  benefit: CadenceBenefit & { readonly resetAnchor: ResetAnchor },
  cardOpenedOn: PlainDate,
): string {
  const cadence = cadenceOf(benefit)
  const calendar = benefit.resetAnchor === 'calendar'
  const opened = toParts(cardOpenedOn)
  const anniversary = `${month(cardOpenedOn)} ${opened.day}`

  switch (cadence) {
    case 'monthly':
      return calendar
        ? 'Resets on the 1st of each month'
        : `Resets on the ${ordinal(opened.day)} of each month`
    case 'quarterly':
      return calendar
        ? 'Resets Jan 1, Apr 1, Jul 1, and Oct 1'
        : 'Resets every 3 months from your open date'
    case 'semiannual':
      return calendar ? 'Resets Jan 1 and Jul 1' : 'Resets every 6 months from your open date'
    case 'annual':
      return calendar ? 'Resets Jan 1' : `Resets on your card anniversary, ${anniversary}`
    case 'multi_year':
      return `Once every ${benefit.resetInterval} years`
    case 'one_time':
      return 'One time only'
    case 'other':
      return `Resets every ${benefit.resetInterval} ${benefit.resetType === 'monthly' ? 'months' : 'periods'}`
  }
}
