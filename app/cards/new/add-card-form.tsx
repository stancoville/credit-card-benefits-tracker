'use client'

/**
 * Add a card. The open date matters more than it looks: it anchors every cardmember-year
 * period and every period key (SPEC §5.2), so the copy asks for the account open date rather
 * than "start date".
 *
 * The card is chosen issuer-first. A flat list of every product is already unwieldy at 31
 * and only grows, and people know their issuer before they know the exact product name — so
 * narrowing by issuer first turns one long scan into two short ones.
 */

import { useActionState, useEffect, useMemo, useState } from 'react'
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

  const issuers = useMemo(() => {
    const seen = new Map<string, { slug: string; name: string; count: number }>()
    for (const product of products) {
      const existing = seen.get(product.issuerSlug)
      if (existing) existing.count += 1
      else seen.set(product.issuerSlug, { slug: product.issuerSlug, name: product.issuerName, count: 1 })
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [products])

  // Skip the first step entirely when there is only one issuer to choose from.
  const [issuerSlug, setIssuerSlug] = useState(issuers.length === 1 ? issuers[0]!.slug : '')
  const [productId, setProductId] = useState('')

  const forIssuer = useMemo(
    () => products.filter((product) => product.issuerSlug === issuerSlug),
    [products, issuerSlug],
  )
  const chosen = products.find((product) => product.id === productId)

  // Help text follows the issuer step, so it is available before a card is even picked.
  const issuerHint = forIssuer[0]?.issuerAccountOpenedHint ?? null
  const issuerName = forIssuer[0]?.issuerName ?? ''

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
          <span className="font-medium">Issuer</span>
          <select
            value={issuerSlug}
            onChange={(event) => {
              setIssuerSlug(event.target.value)
              setProductId('')
            }}
            className="border-hairline mt-1 w-full rounded border bg-white px-3 py-2"
          >
            <option value="">Choose an issuer</option>
            {issuers.map((issuer) => (
              <option key={issuer.slug} value={issuer.slug}>
                {issuer.name} ({issuer.count})
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="font-medium">Card</span>
          <select
            name="productId"
            required
            value={productId}
            disabled={issuerSlug === ''}
            onChange={(event) => setProductId(event.target.value)}
            className="border-hairline mt-1 w-full rounded border bg-white px-3 py-2 disabled:opacity-50"
          >
            <option value="">
              {issuerSlug === '' ? 'Pick an issuer first' : 'Choose a card'}
            </option>
            {forIssuer.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} — {formatCents(product.annualFee)}/yr
              </option>
            ))}
          </select>
          {chosen ? (
            <span className="text-muted mt-1 block text-xs">
              {chosen.creditCount} tracked {chosen.creditCount === 1 ? 'credit' : 'credits'}
              {chosen.perkCount > 0
                ? ` · ${chosen.perkCount} ${chosen.perkCount === 1 ? 'perk' : 'perks'}`
                : ''}
            </span>
          ) : null}
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

        <div className="text-sm">
          <label className="block">
            <span className="font-medium">Account opened</span>
            <input
              type="date"
              name="openedOn"
              required
              max={today}
              className="figure border-hairline mt-1 w-full rounded border px-3 py-2"
            />
          </label>
          <p className="text-muted mt-1 text-xs">
            This anchors every cardmember-year benefit and every deadline on this card, so a
            wrong date shifts all of them.
          </p>

          {/*
            Most people do not know this date offhand, and for one issuer the obvious-looking
            field is the wrong one — so the help is issuer-specific and always reachable.
          */}
          <details className="border-hairline bg-paper mt-2 rounded border px-3 py-2">
            <summary className="text-muted hover:text-ink cursor-pointer text-xs">
              Where do I find this?
            </summary>
            <div className="mt-2 space-y-2 text-xs">
              {issuerHint ? (
                <p>
                  <span className="text-ink font-medium">{issuerName}: </span>
                  <span className="text-muted">{issuerHint}</span>
                </p>
              ) : (
                <p className="text-muted">Pick an issuer above for guidance specific to them.</p>
              )}
              <p className="text-muted">
                <span className="text-ink font-medium">Any issuer: </span>
                your credit report lists a &ldquo;Date opened&rdquo; for every card, and it is
                the authoritative answer if the issuer&rsquo;s page is unclear. Free weekly at{' '}
                <a
                  href="https://www.annualcreditreport.com"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-ink underline"
                >
                  annualcreditreport.com
                </a>
                . Your welcome email or cardholder agreement usually has it too.
              </p>
              <p className="text-muted">
                If you can only find the month, the first of that month is a reasonable
                starting point — you can remove the card and re-add it once you know.
              </p>
            </div>
          </details>
        </div>

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
            placeholder={
              chosen ? `Leave blank for ${formatCents(chosen.annualFee)}` : 'Leave blank to use the catalog fee'
            }
            className="figure border-hairline mt-1 w-full rounded border px-3 py-2"
          />
          <span className="text-muted mt-1 block text-xs">
            Use this if you are grandfathered on an older fee.
          </span>
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
              Benefits that only reach the primary cardholder will not be counted on it.
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
