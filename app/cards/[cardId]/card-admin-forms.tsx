'use client'

/**
 * Card-level controls: mark a benefit not applicable, and close or reopen the card.
 *
 * "Not applicable to us" is a standing judgment, distinct from a lapse — it is reported
 * separately and never folded into potential (SPEC §4, §4.2).
 *
 * Each component is exported individually rather than grouped in a namespace object: the
 * RSC boundary can only serialise a client component that is its own named export, so
 * `Namespace.Component` arrives in the server render as `undefined`.
 */

import { useActionState } from 'react'
import { closeCard, reopenCard, setExclusion, type ActionResult } from '@/app/actions'

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

export function ExclusionToggle({
  cardId,
  benefitId,
  excluded,
}: {
  cardId: string
  benefitId: string
  excluded: boolean
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setExclusion,
    null,
  )

  return (
    <div className="text-right">
      <form action={action}>
        <input type="hidden" name="cardId" value={cardId} />
        <input type="hidden" name="benefitId" value={benefitId} />
        <input type="hidden" name="exclude" value={excluded ? 'false' : 'true'} />
        <button
          type="submit"
          disabled={pending}
          className="text-muted hover:text-ink text-xs underline decoration-dotted disabled:opacity-60"
        >
          {excluded ? 'Count this again' : 'Not applicable to us'}
        </button>
      </form>
      <Status state={state} />
    </div>
  )
}

export function CloseCard({
  cardId,
  closedOn,
  today,
}: {
  cardId: string
  closedOn: string | null
  today: string
}) {
  const [closeState, closeAction, closePending] = useActionState<ActionResult | null, FormData>(
    closeCard,
    null,
  )
  const [reopenState, reopenAction, reopenPending] = useActionState<ActionResult | null, FormData>(
    reopenCard,
    null,
  )

  if (closedOn) {
    return (
      <div className="border-hairline bg-surface border p-4">
        <p className="text-sm">
          This card is closed as of <span className="figure">{closedOn}</span>. No periods exist
          after that date.
        </p>
        <form action={reopenAction} className="mt-3">
          <input type="hidden" name="cardId" value={cardId} />
          <button
            type="submit"
            disabled={reopenPending}
            className="border-hairline hover:bg-paper rounded border px-3 py-1.5 text-sm disabled:opacity-60"
          >
            {reopenPending ? 'Reopening…' : 'Reopen card'}
          </button>
        </form>
        <Status state={reopenState} />
      </div>
    )
  }

  return (
    <div className="border-hairline bg-surface border p-4">
      <form action={closeAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="cardId" value={cardId} />
        <label className="text-sm">
          <span className="text-muted block text-xs">Closed on</span>
          <input
            type="date"
            name="closedOn"
            required
            max={today}
            className="figure border-hairline mt-1 rounded border px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={closePending}
          className="border-hairline hover:bg-paper rounded border px-3 py-1.5 text-sm disabled:opacity-60"
        >
          {closePending ? 'Closing…' : 'Close card'}
        </button>
      </form>
      <p className="text-muted mt-2 text-xs">
        Closing keeps the history and stops counting periods after that date.
      </p>
      <Status state={closeState} />
    </div>
  )
}
