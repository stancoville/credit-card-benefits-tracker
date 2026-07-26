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
import { enrollBenefit, markUsed, type ActionResult } from '@/app/actions'
import { formatCents } from '@/lib/money'

export function BenefitRowActions({
  cardId,
  benefitId,
  benefitName,
  remaining,
  needsEnrollment,
  asOf,
}: {
  cardId: string
  benefitId: string
  benefitName: string
  remaining: number
  needsEnrollment: boolean
  asOf: string
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
