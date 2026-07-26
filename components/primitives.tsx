/**
 * Small shared display pieces. SPEC §6 fixes the tokens; these keep their use consistent.
 *
 * Every dollar amount and date renders through `Figure`, which applies IBM Plex Mono with
 * tabular figures. That is a spec requirement, not a preference: figures in a dense list
 * must not shift sideways when a number changes.
 */

import { differenceInDays, toParts, type PlainDate } from '@/lib/date/plain-date'
import { formatCents } from '@/lib/money'

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

/** `2026-07-31` → `Jul 31`. Formatted from the parts, never through `new Date()`. */
export function formatDate(date: PlainDate, options: { withYear?: boolean } = {}): string {
  const { year, month, day } = toParts(date)
  const base = `${MONTHS[month - 1]} ${day}`
  return options.withYear === true ? `${base}, ${year}` : base
}

export function formatMonth(date: PlainDate, options: { withYear?: boolean } = {}): string {
  const { year, month } = toParts(date)
  return options.withYear === true
    ? `${MONTHS[month - 1]} ${String(year).slice(2)}`
    : (MONTHS[month - 1] as string)
}

/** Plain-language time remaining. "Today" and "Tomorrow" read better than "in 0 days". */
export function formatDaysLeft(days: number): string {
  if (!Number.isFinite(days)) return 'No deadline'
  if (days < 0) return 'Closed'
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `${days} days`
}

export function daysUntil(asOf: PlainDate, target: PlainDate): number {
  return differenceInDays(asOf, target)
}

export function Figure({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return <span className={`figure ${className}`}>{children}</span>
}

export function Money({
  cents,
  className = '',
  alwaysCents = false,
}: {
  cents: number
  className?: string
  alwaysCents?: boolean
}) {
  return <Figure className={className}>{formatCents(cents, { alwaysCents })}</Figure>
}

/** Card chip with the owner's initial, per SPEC §6's deadline row. */
export function CardChip({ label, initial }: { label: string; initial: string }) {
  return (
    <span className="text-muted inline-flex items-center gap-1.5 text-xs">
      <span
        aria-hidden="true"
        className="border-hairline text-ink inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-medium"
      >
        {initial}
      </span>
      {label}
    </span>
  )
}

export function Panel({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`border-hairline bg-surface border ${className}`}>{children}</section>
  )
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-muted mb-3 text-xs font-medium tracking-wide uppercase">{children}</h2>
  )
}

export function EmptyState({
  title,
  children,
}: {
  title: string
  children?: React.ReactNode
}) {
  return (
    <div className="border-hairline bg-surface border border-dashed px-4 py-8 text-center">
      <p className="text-ink font-medium">{title}</p>
      {children ? <div className="text-muted mt-2 text-sm">{children}</div> : null}
    </div>
  )
}
