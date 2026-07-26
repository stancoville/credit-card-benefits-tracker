import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  asOfFor,
  getHousehold,
  getMembers,
  getProductOptions,
  isDatabaseConfigured,
} from '@/lib/app/queries'
import { NeedsDatabase } from '@/components/needs-database'
import { EmptyState } from '@/components/primitives'
import { AddCardForm } from './add-card-form'

export const dynamic = 'force-dynamic'

export default async function NewCardPage() {
  if (!isDatabaseConfigured()) return <NeedsDatabase />

  const household = await getHousehold()
  if (!household) redirect('/setup')

  const [products, members] = await Promise.all([
    getProductOptions(),
    getMembers(household.id),
  ])

  if (products.length === 0) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="display text-2xl font-semibold">Add a card</h1>
        <EmptyState title="The catalog has no card products yet.">
          <p>
            A card is chosen from the catalog so its benefits come with them. Catalog entries
            live in <code>/catalog</code> and every benefit needs a <code>source_url</code> and{' '}
            <code>verified_on</code> from the issuer&rsquo;s terms — see{' '}
            <code>catalog/README.md</code>, then run <code>pnpm seed</code>.
          </p>
        </EmptyState>
        <Link href="/cards" className="text-muted hover:text-ink text-sm underline">
          Back to cards
        </Link>
      </div>
    )
  }

  return (
    <AddCardForm
      products={products}
      members={members}
      today={asOfFor(household)}
      householdName={household.name}
    />
  )
}
