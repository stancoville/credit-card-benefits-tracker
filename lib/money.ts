/**
 * The render boundary for money (CLAUDE.md hard rule 1).
 *
 * Money is integer cents everywhere else in the app. This module is the only place it
 * changes representation — cents to a string for display, and a typed dollar amount back
 * to cents on input. Keeping both directions here means there is exactly one place a
 * rounding or unit bug can live.
 */

/** Thrown when user input cannot be read as a dollar amount. */
export class InvalidAmountError extends Error {
  constructor(value: string) {
    super(`${JSON.stringify(value)} is not an amount. Enter dollars, like 12.50.`)
    this.name = 'InvalidAmountError'
  }
}

const DOLLARS = /^-?\$?\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/

/**
 * Parse a typed dollar amount into integer cents.
 *
 * Accepts `12`, `12.5`, `12.50`, `$12.50`, `1,234.56`. Rejects anything with more than two
 * decimal places rather than rounding it: silently turning `1.005` into `1.00` loses money
 * the person believed they entered.
 */
export function parseDollarsToCents(value: string): number {
  const trimmed = value.trim()
  if (trimmed === '') throw new InvalidAmountError(value)

  const match = DOLLARS.exec(trimmed)
  if (!match) throw new InvalidAmountError(value)

  const whole = Number(match[1]!.replace(/,/g, ''))
  const fraction = match[2] ?? ''
  const cents = Number(fraction.padEnd(2, '0'))

  if (!Number.isSafeInteger(whole)) throw new InvalidAmountError(value)

  const total = whole * 100 + cents
  return trimmed.startsWith('-') ? -total : total
}

/**
 * Format integer cents for display: `1500` → `$15`, `1550` → `$15.50`.
 *
 * Whole dollars drop the `.00` because §6 puts these figures in a dense deadline list where
 * two dead characters per row is noise. Pass `alwaysCents` when a column must align.
 */
export function formatCents(cents: number, options: { alwaysCents?: boolean } = {}): string {
  const negative = cents < 0
  const absolute = Math.abs(cents)
  const dollars = Math.floor(absolute / 100)
  const remainder = absolute % 100

  const body =
    remainder === 0 && options.alwaysCents !== true
      ? dollars.toLocaleString('en-US')
      : `${dollars.toLocaleString('en-US')}.${String(remainder).padStart(2, '0')}`

  return `${negative ? '−' : ''}$${body}`
}

/** Compact form for tight spaces: `69500` → `$695`, `1250000` → `$12.5k`. */
export function formatCentsCompact(cents: number): string {
  const absolute = Math.abs(cents)
  if (absolute < 1_000_00) return formatCents(cents)
  const thousands = absolute / 100_000
  // Keep one decimal below $100k: on a dashboard, $12.5k says more than $13k.
  const rounded = thousands >= 100 ? Math.round(thousands) : Math.round(thousands * 10) / 10
  return `${cents < 0 ? '−' : ''}$${rounded}k`
}
