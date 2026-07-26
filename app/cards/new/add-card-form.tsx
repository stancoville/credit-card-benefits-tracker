'use client'

/**
 * Add a card. The open date matters more than it looks: it anchors every cardmember-year
 * period and every period key (SPEC §5.2), so the copy asks for the account open date rather
 * than "start date".
 */

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { addCard, type ActionResult } from '@/app/actions'
import type { Member, ProductOption } from '@/lib/app/queries'
import { formatCents } from '@/lib/money'

export function AddCardForm({
  products,
  members,
  today,
  householdName,
}: {
  products: ProductOption[]
  members: Member[]
  today: string
  householdName: string
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addCard, null)
  const router = useRouter()

  useEffect(() => {
    if (state?.ok) router.push('/cards')
  }, [state, router])

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <header>
        <h1 className="display text-2xl font-semibold">Add a card</h1>
        <p className="text-muted mt-1 text-sm">{householdName}</p>
      </header>

      <form action={action} className="border-hairline bg-surface space-y-5 border p-5">
        <label className="block text-sm">
          <span className="font-medium">Card</span>
          <select
            name="productId"
            required
            defaultValue=""
            className="border-hairline mt-1 w-full rounded border bg-white px-3 py-2"
          >
            <option value="" disabled>
              Choose a card
            </option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.issuerName} — {product.name} ({formatCents(product.annualFee)}/yr)
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="font-medium">Who holds it</span>
          <select
            name="ownerUserId"
            required
            defaultValue={members[0]?.id ?? ''}
            className="border-hairline mt-1 w-full rounded border bg-white px-3 py-2"
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="font-medium">Account opened</span>
          <input
            type="date"
            name="openedOn"
            required
            max={today}
            className="figure border-hairline mt-1 w-full rounded border px-3 py-2"
          />
          <span className="text-muted mt-1 block text-xs">
            This anchors every cardmember-year benefit, so use the real account open date.
          </span>
        </label>

        <label className="block text-sm">
          <span className="font-medium">
            Nickname <span className="text-muted font-normal">(optional)</span>
          </span>
          <input
            name="nickname"
            placeholder="Travel card"
            className="border-hairline mt-1 w-full rounded border px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          <span className="font-medium">
            Annual fee <span className="text-muted font-normal">(optional override)</span>
          </span>
          <input
            name="annualFeeOverride"
            inputMode="decimal"
            placeholder="Leave blank to use the catalog fee"
            className="figure border-hairline mt-1 w-full rounded border px-3 py-2"
          />
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="isAuthorizedUser"
            className="border-hairline mt-0.5 rounded border"
          />
          <span>
            This is an authorized user card
            <span className="text-muted block text-xs">
              Rather than the primary account holder&rsquo;s own card.
            </span>
          </span>
        </label>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="bg-ink text-paper hover:bg-ink/90 disabled:opacity-60 rounded px-4 py-2.5 font-medium"
          >
            {pending ? 'Adding…' : 'Add card'}
          </button>
          <Link href="/cards" className="text-muted hover:text-ink text-sm underline">
            Cancel
          </Link>
        </div>

        {state && !state.ok ? (
          <p role="status" aria-live="polite" className="text-maroon text-sm">
            {state.error}
          </p>
        ) : null}
      </form>
    </div>
  )
}
