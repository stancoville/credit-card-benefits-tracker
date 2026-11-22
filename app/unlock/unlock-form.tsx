'use client'

import { useActionState } from 'react'
import { unlock, type UnlockResult } from './actions'

export function UnlockForm({ next, setupError }: { next: string; setupError: string | null }) {
  const [state, action, pending] = useActionState<UnlockResult, FormData>(unlock, null)
  const error = setupError ?? state?.error ?? null

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <header>
        <h1 className="display text-2xl font-semibold">Enter your PIN</h1>
        <p className="text-muted mt-2 text-sm">
          This browser stays unlocked for 90 days.
        </p>
      </header>

      <form action={action} className="border-hairline bg-surface space-y-5 border p-5">
        <input type="hidden" name="next" value={next} />
        <label className="block text-sm">
          <span className="font-medium">Household PIN</span>
          <input
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            required
            autoFocus
            className="figure border-hairline mt-1 w-full rounded border px-3 py-2 tracking-widest"
          />
        </label>

        <button
          type="submit"
          disabled={pending || setupError !== null}
          className="bg-ink text-paper hover:bg-ink/90 disabled:opacity-60 w-full rounded px-4 py-2.5 font-medium"
        >
          {pending ? 'Unlocking…' : 'Unlock'}
        </button>

        {error ? (
          <p role="status" aria-live="polite" className="text-maroon text-sm">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  )
}
