'use client'

/**
 * Period-by-period history for a monthly, quarterly, or twice-a-year credit, across the
 * current card year (the same periods the totals above it count — SPEC §4.1).
 *
 * People don't open the app every month, so this is where they catch up: tap a past
 * period to mark it used, tap a used one to mark it unused. A backdated "Mark used" is the
 * true-up path in SPEC §4.3. The verb stays constant: the control says "Mark used", the
 * status says "Marked used".
 *
 * Colour follows SPEC §6 and nothing else: teal = captured, maroon = forfeited.
 */

import { useActionState, useState } from 'react'
import { markUnused, markUsed, type ActionResult } from '@/app/actions'
import type { Cadence, ChipStatus, PeriodChip } from '@/lib/app/period-history'
import { formatCents } from '@/lib/money'

const GRID_COLUMNS: Partial<Record<Cadence, string>> = {
  monthly: 'grid-cols-6 sm:grid-cols-12',
  quarterly: 'grid-cols-4',
  semiannual: 'grid-cols-2',
}

const STATUS_TEXT: Record<ChipStatus, string> = {
  used: 'used',
  partial: 'partly used',
  missed: 'missed',
  open: 'not used yet',
  upcoming: 'not started',
}

const CHIP_STYLE: Record<ChipStatus, string> = {
  used: 'bg-teal border-teal text-paper',
  partial: 'border-teal text-teal bg-surface',
  missed: 'border-maroon text-maroon bg-maroon/10',
  open: 'border-ink text-ink bg-surface font-semibold',
  upcoming: 'border-hairline border-dashed text-muted bg-surface',
}

export function PeriodGrid({
  cardId,
  benefitId,
  cadence,
  chips,
}: {
  cardId: string
  benefitId: string
  cadence: Cadence
  chips: readonly PeriodChip[]
}) {
  const [usedState, usedAction, usedPending] = useActionState<ActionResult | null, FormData>(
    markUsed,
    null,
  )
  const [unusedState, unusedAction, unusedPending] = useActionState<ActionResult | null, FormData>(
    markUnused,
    null,
  )
  const [last, setLast] = useState<{ kind: 'used' | 'unused'; label: string } | null>(null)
  const pending = usedPending || unusedPending
  const state = last?.kind === 'unused' ? unusedState : usedState

  return (
    <div className="mt-3">
      <ol className={`grid gap-1.5 ${GRID_COLUMNS[cadence] ?? 'grid-cols-4'}`}>
        {chips.map((chip) => {
          const fullyUsed = chip.status === 'used'
          const label = `${chip.label}${chip.yearLabel ? ` ${chip.yearLabel}` : ''}`
          const verb = fullyUsed ? 'Mark unused' : 'Mark used'
          const amount =
            chip.status === 'partial'
              ? `, ${formatCents(chip.captured)} of ${formatCents(chip.maxValue)}`
              : ''

          return (
            <li key={chip.periodStart} className="flex flex-col">
              <span className="figure text-muted h-4 text-[10px] leading-4">
                {chip.yearLabel ?? ''}
              </span>
              {chip.markOn === null ? (
                <span
                  className={`figure flex h-9 items-center justify-center rounded border text-xs ${CHIP_STYLE[chip.status]}`}
                  aria-label={`${chip.rangeLabel}: ${STATUS_TEXT[chip.status]}`}
                  title={`${chip.rangeLabel} · ${STATUS_TEXT[chip.status]}`}
                >
                  {chip.label}
                </span>
              ) : (
                <form action={fullyUsed ? unusedAction : usedAction}>
                  <input type="hidden" name="cardId" value={cardId} />
                  <input type="hidden" name="benefitId" value={benefitId} />
                  {fullyUsed ? (
                    <input type="hidden" name="periodStart" value={chip.periodStart} />
                  ) : (
                    <input type="hidden" name="occurredOn" value={chip.markOn} />
                  )}
                  <button
                    type="submit"
                    disabled={pending}
                    onClick={() => setLast({ kind: fullyUsed ? 'unused' : 'used', label })}
                    aria-pressed={fullyUsed}
                    aria-label={`${chip.rangeLabel}: ${STATUS_TEXT[chip.status]}${amount}. ${verb}.`}
                    title={`${chip.rangeLabel} · ${STATUS_TEXT[chip.status]}${amount} · ${verb}`}
                    className={`figure flex h-9 w-full items-center justify-center gap-0.5 rounded border text-xs transition-colors hover:brightness-95 disabled:opacity-60 motion-reduce:transition-none ${CHIP_STYLE[chip.status]}`}
                  >
                    {fullyUsed ? <span aria-hidden="true">✓</span> : null}
                    {chip.label}
                  </button>
                </form>
              )}
            </li>
          )
        })}
      </ol>

      {state && last ? (
        <p
          role="status"
          aria-live="polite"
          className={`mt-2 text-xs ${state.ok ? 'text-teal' : 'text-maroon'}`}
        >
          {state.ok ? `${last.label}: ${state.message}` : state.error}
        </p>
      ) : null}
    </div>
  )
}

/** One legend per page, above the credits, rather than repeated under every grid. */
export function PeriodGridLegend() {
  const swatch = 'figure inline-flex h-5 items-center rounded border px-1.5 text-[10px]'
  return (
    <p className="text-muted mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
      <span className={`${swatch} ${CHIP_STYLE.used}`}>✓ Used</span>
      <span className={`${swatch} ${CHIP_STYLE.missed}`}>Missed</span>
      <span className={`${swatch} ${CHIP_STYLE.open}`}>Now</span>
      <span className={`${swatch} ${CHIP_STYLE.upcoming}`}>Later</span>
      <span>Tap a period to mark it used; tap a used one to undo. Missed counts as forfeited.</span>
    </p>
  )
}
