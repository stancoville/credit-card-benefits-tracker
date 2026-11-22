'use client'

/**
 * The row action — SPEC §6.
 *
 * "Mark used must be one gesture." The primary button submits with no amount, which the
 * action reads as the full remaining value. A partial amount lives behind a secondary
 * disclosure rather than a long-press: §10 settled that, because long-press has no visible
 * affordance and no keyboard equivalent.
 *
 * "Not enrolled" is a distinct, louder state than unused, and its action is "Enroll", not
 * "Mark used" — an unenrolled credit is worth $0 regardless of intent.
 *
 * The verb stays constant through the flow: the button says "Mark used", the confirmation
 * says "Marked used."
 */

import { useActionState, useId, useState } from 'react'
import { enrollBenefit, markUnused, markUsed, type ActionResult } from '@/app/actions'
import { formatCents } from '@/lib/money'

export function BenefitRowActions({
  cardId,
  benefitId,
  benefitName,
  remaining,
  needsEnrollment,
  asOf,
  isEstimated = false,
}: {
  cardId: string
  benefitId: string
  benefitName: string
  remaining: number
  needsEnrollment: boolean
  asOf: string
  /**
   * SPEC §4.6: the value is whatever the household got for it (a free night on a $180 or a
   * $900 room), so "Mark used" asks for it rather than recording the estimate. `remaining`
   * is then the catalog's estimate, shown as a hint, never as a cap.
   */
  isEstimated?: boolean
}) {
  const [markState, markAction, markPending] = useActionState<ActionResult | null, FormData>(
    markUsed,
    null,
  )
  const [enrollState, enrollAction, enrollPending] = useActionState<ActionResult | null, FormData>(
    enrollBenefit,
    null,
  )
  const [showPartial, setShowPartial] = useState(false)
  const panelId = useId()

  const state = needsEnrollment ? enrollState : markState
  const pending = markPending || enrollPending

  if (needsEnrollment) {
    return (
      <div className="text-right">
        <form action={enrollAction}>
          <input type="hidden" name="cardId" value={cardId} />
          <input type="hidden" name="benefitId" value={benefitId} />
          <button
            type="submit"
            disabled={enrollPending}
            className="bg-ink text-paper hover:bg-ink/90 disabled:opacity-60 rounded px-3 py-1.5 text-sm font-medium"
          >
            {enrollPending ? 'Enrolling…' : 'Enroll'}
          </button>
        </form>
        <Status state={state} />
      </div>
    )
  }

  if (isEstimated) {
    return (
      <div className="text-right">
        <button
          type="button"
          onClick={() => setShowPartial((open) => !open)}
          aria-expanded={showPartial}
          aria-controls={panelId}
          className="bg-ink text-paper hover:bg-ink/90 rounded px-3 py-1.5 text-sm font-medium whitespace-nowrap"
        >
          Mark used
        </button>

        {showPartial ? (
          <form
            id={panelId}
            action={markAction}
            className="border-hairline bg-paper mt-2 w-64 max-w-full space-y-2 rounded border p-3 text-left"
          >
            <input type="hidden" name="cardId" value={cardId} />
            <input type="hidden" name="benefitId" value={benefitId} />

            <label className="block text-xs">
              <span className="font-medium">What was it worth?</span>
              <input
                name="amount"
                inputMode="decimal"
                required
                autoFocus
                placeholder={formatCents(remaining)}
                className="figure border-hairline mt-1 w-full rounded border px-2 py-1 text-sm"
              />
              <span className="text-muted mt-1 block">
                What you would have paid in cash. Our estimate is {formatCents(remaining)}.
              </span>
            </label>

            <label className="block text-xs">
              <span className="text-muted">Date used</span>
              <input
                type="date"
                name="occurredOn"
                defaultValue={asOf}
                max={asOf}
                className="figure border-hairline mt-1 w-full rounded border px-2 py-1 text-sm"
              />
            </label>

            <label className="block text-xs">
              <span className="text-muted">Note</span>
              <input
                name="note"
                placeholder="Which hotel…"
                className="border-hairline mt-1 w-full rounded border px-2 py-1 text-sm"
              />
            </label>

            <button
              type="submit"
              disabled={markPending}
              className="bg-ink text-paper hover:bg-ink/90 disabled:opacity-60 w-full rounded px-3 py-1.5 text-sm font-medium"
            >
              {markPending ? 'Marking…' : 'Mark used'}
            </button>
          </form>
        ) : null}

        <Status state={markState} />
      </div>
    )
  }

  return (
    <div className="text-right">
      <div className="flex items-center justify-end gap-2">
        <form action={markAction}>
          <input type="hidden" name="cardId" value={cardId} />
          <input type="hidden" name="benefitId" value={benefitId} />
          {/* No amount field: the action defaults to the full remaining value. */}
          <button
            type="submit"
            disabled={pending}
            className="bg-ink text-paper hover:bg-ink/90 disabled:opacity-60 rounded px-3 py-1.5 text-sm font-medium whitespace-nowrap"
          >
            {markPending ? 'Marking…' : 'Mark used'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setShowPartial((open) => !open)}
          aria-expanded={showPartial}
          aria-controls={panelId}
          className="text-muted hover:text-ink rounded border border-transparent px-1.5 py-1 text-xs underline decoration-dotted"
        >
          Part
        </button>
      </div>

      {showPartial ? (
        <form
          id={panelId}
          action={markAction}
          className="border-hairline bg-paper mt-2 space-y-2 rounded border p-3 text-left"
        >
          <input type="hidden" name="cardId" value={cardId} />
          <input type="hidden" name="benefitId" value={benefitId} />

          <p className="text-muted text-xs">
            {benefitName} — {formatCents(remaining)} left
          </p>

          <label className="block text-xs">
            <span className="text-muted">Amount used</span>
            <input
              name="amount"
              inputMode="decimal"
              placeholder={formatCents(remaining)}
              className="figure border-hairline mt-1 w-full rounded border px-2 py-1 text-sm"
            />
          </label>

          <label className="block text-xs">
            <span className="text-muted">Date used</span>
            <input
              type="date"
              name="occurredOn"
              defaultValue={asOf}
              max={asOf}
              className="figure border-hairline mt-1 w-full rounded border px-2 py-1 text-sm"
            />
          </label>

          <label className="block text-xs">
            <span className="text-muted">Note</span>
            <input
              name="note"
              placeholder="Which hotel, which airline…"
              className="border-hairline mt-1 w-full rounded border px-2 py-1 text-sm"
            />
          </label>

          <button
            type="submit"
            disabled={pending}
            className="bg-ink text-paper hover:bg-ink/90 disabled:opacity-60 w-full rounded px-3 py-1.5 text-sm font-medium"
          >
            {markPending ? 'Marking…' : 'Mark used'}
          </button>
        </form>
      ) : null}

      <Status state={state} />
    </div>
  )
}

/**
 * Undo for a credit without a period grid (annual, multi-year, one-time): removes what was
 * recorded for this period. The grid has its own undo; this covers everything else.
 */
export function MarkUnusedButton({
  cardId,
  benefitId,
  periodStart,
}: {
  cardId: string
  benefitId: string
  periodStart: string
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(markUnused, null)
  return (
    <div className="text-right">
      <form action={action}>
        <input type="hidden" name="cardId" value={cardId} />
        <input type="hidden" name="benefitId" value={benefitId} />
        <input type="hidden" name="periodStart" value={periodStart} />
        <button
          type="submit"
          disabled={pending}
          className="border-hairline hover:border-ink disabled:opacity-60 rounded border px-3 py-1.5 text-sm whitespace-nowrap"
        >
          {pending ? 'Marking…' : 'Mark unused'}
        </button>
      </form>
      <Status state={state} />
    </div>
  )
}

function Status({ state }: { state: ActionResult | null }) {
  if (!state) return null
  return (
    <p
      role="status"
      aria-live="polite"
      className={`mt-1.5 text-xs ${state.ok ? 'text-teal' : 'text-maroon'}`}
    >
      {state.ok ? state.message : state.error}
    </p>
  )
}
