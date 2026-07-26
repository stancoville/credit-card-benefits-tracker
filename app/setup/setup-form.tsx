'use client'

/**
 * First-run setup: the household and the people in it.
 *
 * There is no auth in v1 (SPEC §3.2). Cards attach to people so value can be attributed per
 * person, which is the only reason `users` exists.
 */

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { setupHousehold, type ActionResult } from '@/app/actions'

const DEFAULT_TIMEZONE = 'America/New_York'

export function SetupForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setupHousehold,
    null,
  )
  const [memberCount, setMemberCount] = useState(2)
  const router = useRouter()

  // Navigate as an effect, never during render.
  useEffect(() => {
    if (state?.ok) router.push('/cards/new')
  }, [state, router])

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <header>
        <h1 className="display text-2xl font-semibold">Set up your household</h1>
        <p className="text-muted mt-2 text-sm">
          Benefit periods are evaluated in one timezone for the whole household, so
          &ldquo;expires Jul 31&rdquo; means the same thing to everyone.
        </p>
      </header>

      <form action={action} className="border-hairline bg-surface space-y-5 border p-5">
        <label className="block text-sm">
          <span className="font-medium">Household name</span>
          <input
            name="name"
            required
            placeholder="Our cards"
            className="border-hairline mt-1 w-full rounded border px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          <span className="font-medium">Timezone</span>
          <input
            name="timezone"
            required
            defaultValue={DEFAULT_TIMEZONE}
            className="figure border-hairline mt-1 w-full rounded border px-3 py-2"
          />
          <span className="text-muted mt-1 block text-xs">
            An IANA name, like America/New_York or Europe/London.
          </span>
        </label>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">People</legend>
          {Array.from({ length: memberCount }, (_, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-2">
              <input
                name="memberName"
                required={index === 0}
                placeholder={index === 0 ? 'Your name' : 'Their name'}
                className="border-hairline rounded border px-3 py-2 text-sm"
              />
              <input
                name="memberEmail"
                type="email"
                placeholder="Email (optional)"
                className="border-hairline rounded border px-3 py-2 text-sm"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setMemberCount((count) => count + 1)}
            className="text-muted hover:text-ink text-sm underline"
          >
            Add another person
          </button>
        </fieldset>

        <button
          type="submit"
          disabled={pending}
          className="bg-ink text-paper hover:bg-ink/90 disabled:opacity-60 w-full rounded px-4 py-2.5 font-medium"
        >
          {pending ? 'Creating…' : 'Create household'}
        </button>

        {state && !state.ok ? (
          <p role="status" aria-live="polite" className="text-maroon text-sm">
            {state.error}
          </p>
        ) : null}
      </form>
    </div>
  )
}
