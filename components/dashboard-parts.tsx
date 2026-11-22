/**
 * Dashboard sections — SPEC §6: hero, ledger bar, cliff strip, deadline groups.
 *
 * Colour carries meaning here and nowhere else: amber = expiring, teal = captured,
 * maroon = forfeited.
 */

import Link from 'next/link'
import type {
  CardSummary,
  CliffMonth,
  DashboardModel,
  DeadlineGroup,
  RepeatableItem,
  UnlockableItem,
} from '@/lib/app/dashboard'
import type { LedgerTotals } from '@/lib/ledger'
import { formatCents } from '@/lib/money'
import {
  CardChip,
  Figure,
  Money,
  Panel,
  SectionHeading,
  formatDate,
  formatDaysLeft,
  formatMonth,
} from './primitives'
import { BenefitRowActions } from './benefit-row-actions'

/** Hero — the one number the app exists to show (SPEC §1, §6). */
export function Hero({ model }: { model: DashboardModel }) {
  const { valueAtRisk, nearestCliff } = model

  return (
    <section className="on-ink bg-ink text-paper px-5 py-7 sm:px-8 sm:py-9">
      <h1 className="text-paper/70 text-xs font-medium tracking-wide uppercase">
        Expiring in the next 30 days
      </h1>
      <p className="display mt-2 text-5xl leading-none font-semibold sm:text-6xl">
        <Figure>{formatCents(valueAtRisk)}</Figure>
      </p>

      {nearestCliff ? (
        <p className="text-paper/80 mt-4 text-sm">
          Next up{' '}
          <Figure className="text-amber font-medium">{formatDate(nearestCliff.date)}</Figure>
          {' — '}
          <Figure className="font-medium">{formatCents(nearestCliff.amount)}</Figure> across{' '}
          {nearestCliff.count} {nearestCliff.count === 1 ? 'benefit' : 'benefits'}
        </p>
      ) : (
        <p className="text-paper/80 mt-4 text-sm">
          Nothing expires in the next 30 days. Everything current is either used or still open.
        </p>
      )}
    </section>
  )
}

/** One stacked bar reconciling potential = captured + forfeited + available (SPEC §6). */
export function LedgerBar({
  totals,
  excluded,
  totalAnnualFees,
}: {
  totals: LedgerTotals
  excluded: number
  totalAnnualFees: number
}) {
  const { potential, captured, forfeited, available, availableNotEnrolled } = totals
  const scale = potential === 0 ? 1 : potential
  const percent = (value: number) => `${((value / scale) * 100).toFixed(3)}%`
  const availableEnrolled = available - availableNotEnrolled

  return (
    <Panel className="p-4 sm:p-5">
      <SectionHeading>This card year</SectionHeading>

      <div
        className="border-hairline flex h-7 w-full overflow-hidden rounded-sm border"
        role="img"
        aria-label={`Potential ${formatCents(potential)}: captured ${formatCents(
          captured,
        )}, forfeited ${formatCents(forfeited)}, still available ${formatCents(available)}`}
      >
        <div className="bg-teal h-full" style={{ width: percent(captured) }} />
        <div className="bg-maroon h-full" style={{ width: percent(forfeited) }} />
        <div className="bg-amber h-full" style={{ width: percent(availableEnrolled) }} />
        {/* Not enrolled is a distinct, louder state than unused (SPEC §6). */}
        <div
          className="bg-amber h-full opacity-45"
          style={{
            width: percent(availableNotEnrolled),
            backgroundImage:
              'repeating-linear-gradient(45deg, transparent 0 4px, rgba(14,17,22,0.28) 4px 8px)',
          }}
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
        <Stat label="Potential" cents={potential} />
        <Stat label="Captured" cents={captured} tone="text-teal" />
        <Stat label="Forfeited" cents={forfeited} tone="text-maroon" />
        <Stat label="Available" cents={available} tone="text-amber" />
      </dl>

      <p className="text-muted mt-4 text-xs">
        {availableNotEnrolled > 0 ? (
          <>
            <Figure className="text-ink font-medium">{formatCents(availableNotEnrolled)}</Figure> of
            that is unenrolled, so it is worth $0 until you enroll.{' '}
          </>
        ) : null}
        Excluded as not applicable <Figure>{formatCents(excluded)}</Figure> · Annual fees{' '}
        <Figure>{formatCents(totalAnnualFees)}</Figure>
      </p>
    </Panel>
  )
}

function Stat({ label, cents, tone = '' }: { label: string; cents: number; tone?: string }) {
  return (
    <div>
      <dt className="text-muted text-xs">{label}</dt>
      <dd className={`mt-0.5 text-base font-medium ${tone}`}>
        <Money cents={cents} />
      </dd>
    </div>
  )
}

/**
 * Twelve months forward, value expiring per month. The December cliff should be visible
 * without reading (SPEC §6).
 *
 * This is the app's single motion moment: the bars draw on load, staggered left to right,
 * and not at all under `prefers-reduced-motion`.
 */
export function CliffStrip({ months }: { months: readonly CliffMonth[] }) {
  const peak = Math.max(...months.map((month) => month.total), 1)
  const hasAny = months.some((month) => month.total > 0)

  return (
    <Panel className="p-4 sm:p-5">
      <SectionHeading>Next 12 months</SectionHeading>

      {hasAny ? (
        <ol className="flex h-40 items-end gap-1 sm:gap-2">
          {months.map((month, index) => {
            const height = month.total === 0 ? 0 : Math.max(3, (month.total / peak) * 100)
            return (
              <li
                key={month.month}
                className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5"
              >
                {/* Twelve dollar figures don't fit side by side on a phone; the bar heights
                    carry the shape there, and each bar's title and the sr-only text carry
                    the figure. */}
                <span className="figure text-muted hidden text-center text-[10px] leading-none whitespace-nowrap sm:block">
                  {month.total > 0 ? formatCents(month.total) : ''}
                </span>
                <span className="sr-only">
                  {formatMonth(month.month, { withYear: true })}: {formatCents(month.total)}
                </span>
                <div className="flex h-full items-end">
                  <div
                    className="cliff-bar bg-amber w-full rounded-t-sm"
                    style={{
                      height: `${height}%`,
                      animationDelay: `${index * 45}ms`,
                    }}
                    title={`${formatMonth(month.month, { withYear: true })}: ${formatCents(
                      month.total,
                    )} across ${month.count} ${month.count === 1 ? 'benefit' : 'benefits'}`}
                  />
                </div>
                <span className="figure text-muted text-center text-[10px] leading-none">
                  {formatMonth(month.month)}
                </span>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="text-muted py-8 text-center text-sm">
          Nothing scheduled to expire in the next year.
        </p>
      )}
    </Panel>
  )
}

/**
 * Is each card paying for itself? Captured this card year against its annual fee, one row
 * per card, most behind first (SPEC §4, amended 2026-11-22).
 *
 * The bar's track is the fee and the teal fill is what's been captured toward it. A net
 * shortfall is shown in ink, not maroon: maroon means forfeited, and an unrecovered fee
 * isn't forfeited — the card year may still be young.
 */
export function FeeRecoveryPanel({ cards }: { cards: readonly CardSummary[] }) {
  const rows = [...cards].sort((a, b) => a.feeRecovery - b.feeRecovery)
  const totalFees = cards.reduce((sum, summary) => sum + summary.card.annualFee, 0)
  const totalCaptured = cards.reduce((sum, summary) => sum + summary.totals.captured, 0)

  return (
    <Panel className="p-4 sm:p-5">
      <SectionHeading>Fee recovery</SectionHeading>

      <ul className="space-y-3">
        {rows.map((summary) => {
          const { card, feeRecovery } = summary
          const captured = summary.totals.captured
          const fee = card.annualFee
          const filled = fee === 0 ? 100 : Math.min(100, (captured / fee) * 100)
          const label = card.nickname ?? card.productName
          return (
            <li key={card.id}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <Link
                  href={`/cards/${card.id}`}
                  className="hover:text-ink truncate underline-offset-2 hover:underline"
                >
                  {label}
                </Link>
                <span
                  className={`figure shrink-0 font-medium ${feeRecovery >= 0 ? 'text-teal' : 'text-ink'}`}
                >
                  {feeRecovery > 0 ? '+' : ''}
                  {formatCents(feeRecovery)}
                </span>
              </div>
              <div
                className="bg-hairline mt-1.5 h-2 w-full overflow-hidden rounded-sm"
                role="img"
                aria-label={
                  fee === 0
                    ? `${label}: no annual fee, ${formatCents(captured)} captured`
                    : `${label}: ${formatCents(captured)} captured of a ${formatCents(fee)} fee`
                }
              >
                <div className="bg-teal h-full" style={{ width: `${filled.toFixed(2)}%` }} />
              </div>
              <p className="text-muted mt-1 text-xs">
                {fee === 0 ? (
                  <>
                    No annual fee · <Figure>{formatCents(captured)}</Figure> captured
                  </>
                ) : (
                  <>
                    <Figure>{formatCents(captured)}</Figure> of <Figure>{formatCents(fee)}</Figure>{' '}
                    fee
                  </>
                )}
              </p>
            </li>
          )
        })}
      </ul>

      <p className="text-muted mt-4 text-xs">
        Captured this card year minus each card&rsquo;s annual fee. Across all cards:{' '}
        <Figure className="text-ink">{formatCents(totalCaptured)}</Figure> of{' '}
        <Figure className="text-ink">{formatCents(totalFees)}</Figure> in fees.
      </p>
    </Panel>
  )
}

/** Benefits grouped by period end, soonest first (SPEC §6). */
export function DeadlineGroups({
  groups,
  asOf,
}: {
  groups: readonly DeadlineGroup[]
  asOf: string
}) {
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <Panel key={group.periodEnd}>
          <header className="border-hairline flex items-baseline justify-between border-b px-4 py-2.5">
            <h3 className="text-sm font-medium">
              <Figure>{formatDate(group.periodEnd, { withYear: false })}</Figure>
              <span className="text-muted ml-2 text-xs font-normal">
                {formatDaysLeft(group.daysLeft)}
              </span>
            </h3>
            <p className="text-sm font-medium">
              <Money cents={group.total} />
            </p>
          </header>

          <ul className="divide-hairline divide-y">
            {group.rows.map((row) => (
              <li
                key={`${row.cardId}-${row.benefitId}-${row.period.periodStart}`}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.benefitName}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <CardChip label={row.cardLabel} initial={row.ownerInitial} />
                    {row.merchantScope ? (
                      <span className="text-muted truncate text-xs">{row.merchantScope}</span>
                    ) : null}
                    {row.needsEnrollment ? (
                      <span className="bg-amber/20 text-ink border-amber rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase">
                        Not enrolled
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <p className="text-right text-sm">
                    <Money cents={row.remaining} className="font-medium" />
                    {row.captured > 0 ? (
                      <span className="text-muted block text-xs">
                        of <Money cents={row.maxValue} /> left
                      </span>
                    ) : null}
                  </p>
                  <BenefitRowActions
                    cardId={row.cardId}
                    benefitId={row.benefitId}
                    benefitName={row.benefitName}
                    remaining={row.remaining}
                    needsEnrollment={row.needsEnrollment}
                    asOf={asOf}
                    isEstimated={row.isEstimated}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  )
}

/**
 * Value gated behind a spend threshold (SPEC §4.7).
 *
 * Deliberately its own panel rather than a line in the ledger bar: this is real value, but
 * it is not value you can go and claim today, so folding it into `available` would make the
 * hero figure something you cannot act on.
 */
export function UnlockablePanel({ items }: { items: readonly UnlockableItem[] }) {
  if (items.length === 0) return null
  const total = items.reduce((sum, item) => sum + item.value, 0)

  return (
    <Panel className="p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <SectionHeading>Unlockable with spend</SectionHeading>
        <p className="text-sm font-medium">
          <Money cents={total} />
        </p>
      </div>

      <ul className="divide-hairline divide-y">
        {items.map((item) => (
          <li
            key={`${item.cardId}-${item.benefitId}`}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm">{item.benefitName}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <CardChip label={item.cardLabel} initial={item.ownerInitial} />
                <span className="text-muted text-xs">
                  Spend <Figure>{formatCents(item.unlockSpend)}</Figure>
                  {item.periodEnd ? (
                    <>
                      {' by '}
                      <Figure>{formatDate(item.periodEnd)}</Figure>
                    </>
                  ) : null}
                </span>
              </div>
            </div>
            <p className="text-muted shrink-0 text-right text-sm">
              <Money cents={item.value} />
              {item.isEstimated ? <span className="block text-xs">est.</span> : null}
            </p>
          </li>
        ))}
      </ul>

      <p className="text-muted mt-3 text-xs">
        Not counted in the figures above — this only becomes yours after the spend. Mark it used
        once you have it and it will count normally.
      </p>
    </Panel>
  )
}

/**
 * Per-use benefits (SPEC §4.8).
 *
 * These never appear in the deadline view because nothing about them expires. They are here
 * to answer a different question: "what could I still be using?"
 */
export function RepeatablePanel({ items }: { items: readonly RepeatableItem[] }) {
  if (items.length === 0) return null

  return (
    <Panel className="p-4 sm:p-5">
      <SectionHeading>Every time you use them</SectionHeading>

      <ul className="divide-hairline divide-y">
        {items.map((item) => (
          <li
            key={`${item.cardId}-${item.benefitId}`}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm">{item.benefitName}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <CardChip label={item.cardLabel} initial={item.ownerInitial} />
                <span className="text-muted text-xs">
                  Up to <Figure>{formatCents(item.perUseCap)}</Figure> each time
                </span>
              </div>
            </div>
            <p className="shrink-0 text-right text-sm">
              <Money cents={item.captured} className="text-teal font-medium" />
              <span className="text-muted block text-xs">
                {item.uses === 0
                  ? 'not used yet'
                  : `${item.uses} ${item.uses === 1 ? 'use' : 'uses'} this card year`}
              </span>
            </p>
          </li>
        ))}
      </ul>

      <p className="text-muted mt-3 text-xs">
        No annual cap and nothing to forfeit — the figure is what you have actually captured.
      </p>
    </Panel>
  )
}
