/**
 * PlainDate — a calendar date with no time and no timezone.
 *
 * SPEC §5.4 and CLAUDE.md hard rule 2: every period boundary is a calendar date in the
 * household's timezone, stored as Postgres `date`. "Expires Jul 31" must not shift
 * because the server runs in UTC.
 *
 * A JS `Date` cannot express that. `new Date('2026-07-31')` is an *instant* — UTC
 * midnight — and renders as Jul 30 in America/New_York. So a calendar date is
 * represented as a branded `YYYY-MM-DD` string end to end:
 *
 *   - Drizzle `date(..., { mode: 'string' }).$type<PlainDate>()` returns it directly,
 *     so there is no conversion layer between the DB and this module.
 *   - Lexicographic order equals chronological order, so SQL `ORDER BY` and JS
 *     `.sort()` agree and no comparator is needed.
 *   - It is already wire-format, so it crosses the Server Component → Server Action
 *     boundary without a serializer.
 *
 * This is a documented deviation from the `Date` types written in SPEC §5.1, made in
 * service of that spec's own §5.4. Every function here is pure integer arithmetic; no
 * `Date`, no `Intl`, no clock. The only sanctioned clock reader is `lib/date/now.ts`.
 */

declare const plainDateBrand: unique symbol

/** A calendar date as `YYYY-MM-DD`. Construct via {@link parsePlainDate} or {@link plainDate}. */
export type PlainDate = string & { readonly [plainDateBrand]: true }

export interface DateParts {
  readonly year: number
  /** 1–12. */
  readonly month: number
  /** 1–31. */
  readonly day: number
}

export class InvalidPlainDateError extends Error {
  constructor(value: string, detail: string) {
    super(`Invalid calendar date ${JSON.stringify(value)}: ${detail}. Expected YYYY-MM-DD.`)
    this.name = 'InvalidPlainDateError'
  }
}

const ISO_DATE = /^(-?\d{4,6})-(\d{2})-(\d{2})$/

/** Floor division. All call sites here use non-negative operands after offsetting. */
function div(a: number, b: number): number {
  return Math.floor(a / b)
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

/** Number of days in `month` (1–12) of `year`. */
export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12 || !Number.isInteger(month)) {
    throw new RangeError(`Month out of range: ${String(month)}`)
  }
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return MONTH_LENGTHS[month - 1]!
}

function pad(n: number, width: number): string {
  return String(Math.abs(n)).padStart(width, '0')
}

function format(year: number, month: number, day: number): PlainDate {
  const sign = year < 0 ? '-' : ''
  return `${sign}${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` as PlainDate
}

/**
 * Build a PlainDate from parts, rejecting dates that do not exist (e.g. 2026-02-30).
 * Use {@link plainDateClamped} when overflow should snap to the end of the month instead.
 */
export function plainDate(year: number, month: number, day: number): PlainDate {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new RangeError(`Date parts must be integers: ${year}-${month}-${day}`)
  }
  if (month < 1 || month > 12) throw new RangeError(`Month out of range: ${String(month)}`)
  const max = daysInMonth(year, month)
  if (day < 1 || day > max) {
    throw new RangeError(`Day out of range for ${year}-${pad(month, 2)}: ${String(day)}`)
  }
  return format(year, month, day)
}

/**
 * Build a PlainDate, clamping `day` to the last day of the target month.
 *
 * This is the single place the two month-length edge cases in SPEC §5.3 are resolved:
 * a card opened Feb 29 lands on Feb 28 in non-leap years, and a card opened on the 31st
 * lands on the 30th (or 28th/29th) in shorter months. Every reset type inherits it.
 */
export function plainDateClamped(year: number, month: number, day: number): PlainDate {
  if (month < 1 || month > 12) throw new RangeError(`Month out of range: ${String(month)}`)
  return format(year, month, Math.min(Math.max(day, 1), daysInMonth(year, month)))
}

/** Parse and validate a `YYYY-MM-DD` string. Throws {@link InvalidPlainDateError}. */
export function parsePlainDate(value: string): PlainDate {
  const match = ISO_DATE.exec(value)
  if (!match) throw new InvalidPlainDateError(value, 'malformed')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12) throw new InvalidPlainDateError(value, `month ${month} out of range`)
  const max = daysInMonth(year, month)
  if (day < 1 || day > max) {
    throw new InvalidPlainDateError(value, `day ${day} does not exist in that month`)
  }
  return format(year, month, day)
}

/** True when `value` is a well-formed, existent calendar date. */
export function isPlainDate(value: string): value is PlainDate {
  try {
    parsePlainDate(value)
    return true
  } catch {
    return false
  }
}

export function toParts(date: PlainDate): DateParts {
  const match = ISO_DATE.exec(date)
  if (!match) throw new InvalidPlainDateError(date, 'malformed')
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

export function getYear(date: PlainDate): number {
  return toParts(date).year
}

export function getMonth(date: PlainDate): number {
  return toParts(date).month
}

export function getDayOfMonth(date: PlainDate): number {
  return toParts(date).day
}

/* -------------------------------------------------------------------------- */
/* Epoch-day conversion (Howard Hinnant's civil calendar algorithms)          */
/* -------------------------------------------------------------------------- */

/** Days since 1970-01-01. Pure arithmetic — no `Date` involved. */
export function toEpochDay(date: PlainDate): number {
  const { year, month, day } = toParts(date)
  const y = month <= 2 ? year - 1 : year
  const era = div(y, 400)
  const yoe = y - era * 400
  const doy = div(153 * (month + (month > 2 ? -3 : 9)) + 2, 5) + day - 1
  const doe = yoe * 365 + div(yoe, 4) - div(yoe, 100) + doy
  return era * 146097 + doe - 719468
}

/** Inverse of {@link toEpochDay}. */
export function fromEpochDay(epochDay: number): PlainDate {
  const z = epochDay + 719468
  const era = div(z, 146097)
  const doe = z - era * 146097
  const yoe = div(doe - div(doe, 1460) + div(doe, 36524) - div(doe, 146096), 365)
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + div(yoe, 4) - div(yoe, 100))
  const mp = div(5 * doy + 2, 153)
  const day = doy - div(153 * mp + 2, 5) + 1
  const month = mp + (mp < 10 ? 3 : -9)
  return format(month <= 2 ? y + 1 : y, month, day)
}

/* -------------------------------------------------------------------------- */
/* Arithmetic                                                                 */
/* -------------------------------------------------------------------------- */

export function addDays(date: PlainDate, days: number): PlainDate {
  if (!Number.isInteger(days)) throw new RangeError(`days must be an integer: ${days}`)
  return fromEpochDay(toEpochDay(date) + days)
}

/**
 * Add `months` calendar months, clamping the day to the target month's length.
 * 2026-01-31 + 1 month → 2026-02-28 (SPEC §5.3, monthly periods in short months).
 */
export function addMonths(date: PlainDate, months: number): PlainDate {
  if (!Number.isInteger(months)) throw new RangeError(`months must be an integer: ${months}`)
  const { year, month, day } = toParts(date)
  const total = year * 12 + (month - 1) + months
  return plainDateClamped(div(total, 12), (((total % 12) + 12) % 12) + 1, day)
}

/**
 * Add `years` calendar years, clamping the day.
 * 2024-02-29 + 1 year → 2025-02-28 (SPEC §5.3, leap-day anniversary).
 */
export function addYears(date: PlainDate, years: number): PlainDate {
  return addMonths(date, years * 12)
}

export function startOfMonth(date: PlainDate): PlainDate {
  const { year, month } = toParts(date)
  return format(year, month, 1)
}

export function endOfMonth(date: PlainDate): PlainDate {
  const { year, month } = toParts(date)
  return format(year, month, daysInMonth(year, month))
}

/* -------------------------------------------------------------------------- */
/* Comparison                                                                 */
/* -------------------------------------------------------------------------- */

/** Negative when `a` is earlier, zero when equal, positive when later. */
export function compareDates(a: PlainDate, b: PlainDate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function isBefore(a: PlainDate, b: PlainDate): boolean {
  return a < b
}

export function isAfter(a: PlainDate, b: PlainDate): boolean {
  return a > b
}

export function isSameDay(a: PlainDate, b: PlainDate): boolean {
  return a === b
}

export function isOnOrBefore(a: PlainDate, b: PlainDate): boolean {
  return a <= b
}

export function isOnOrAfter(a: PlainDate, b: PlainDate): boolean {
  return a >= b
}

/** Inclusive on both ends. */
export function isWithin(date: PlainDate, start: PlainDate, end: PlainDate): boolean {
  return date >= start && date <= end
}

export function minDate(a: PlainDate, b: PlainDate): PlainDate {
  return a <= b ? a : b
}

export function maxDate(a: PlainDate, b: PlainDate): PlainDate {
  return a >= b ? a : b
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function differenceInDays(a: PlainDate, b: PlainDate): number {
  return toEpochDay(b) - toEpochDay(a)
}
