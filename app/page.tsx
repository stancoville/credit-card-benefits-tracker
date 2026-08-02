/**
 * Dashboard, defaulting to deadlines (SPEC §6).
 *
 * Dynamic rather than statically generated: every figure depends on `asOf` in the
 * household's timezone, so a build-time snapshot would be wrong by the next morning.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { buildDashboard } from '@/lib/app/dashboard'
import {
  getDashboardInput,
  getHousehold,
  getProductOptions,
  isDatabaseConfigured,
} from '@/lib/app/queries'
import { NeedsDatabase } from '@/components/needs-database'
import {
  CliffStrip,
  DeadlineGroups,
  Hero,
  LedgerBar,
  RepeatablePanel,
  UnlockablePanel,
} from '@/components/dashboard-parts'
import { EmptyState, Figure, Money, SectionHeading } from '@/components/primitives'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  if (!isDatabaseConfigured()) return <NeedsDatabase />

  const household = await getHousehold()
  if (!household) redirect('/setup')

  const input = await getDashboardInput(household)

  if (input.cards.length === 0) {
    const products = await getProductOptions()
    return (
      <div className="space-y-6">
        <h1 className="display text-2xl font-semibold">No cards yet</h1>
        <EmptyState title="Add a card to see what is expiring.">
          {products.length === 0 ? (
            <p>
              The catalog has no card products yet, so there is nothing to pick from. Catalog
              entries live in <code>/catalog</code> and need a source URL from the issuer&rsquo;s
              terms — see <code>catalog/README.md</code>, then run <code>pnpm seed</code>.
            </p>
          ) : (
            <Link href="/cards/new" className="text-ink font-medium underline">
              Add your first card
            </Link>
          )}
        </EmptyState>
      </div>
    )
  }

  const model = buildDashboard(input)

  return (
    <div className="space-y-6">
      <Hero model={model} />

      <div className="grid gap-6 lg:grid-cols-2">
        <LedgerBar
          totals={model.ledgerBar}
          excluded={model.excluded}
          totalAnnualFees={model.totalAnnualFees}
        />
        <CliffStrip months={model.cliffStrip} />
      </div>

      <section>
        <SectionHeading>Deadlines</SectionHeading>
        {model.deadlineGroups.length === 0 ? (
          <EmptyState title="Nothing expires in the next 30 days.">
            <p>
              Everything current is used or still open.{' '}
              <Link href="/cards" className="text-ink underline">
                Review your cards
              </Link>
              .
            </p>
          </EmptyState>
        ) : (
          <DeadlineGroups groups={model.deadlineGroups} asOf={model.asOf} />
        )}
      </section>

      <UnlockablePanel items={model.unlockable} />

      <RepeatablePanel items={model.repeatable} />

      {model.orphanedRedemptions.count > 0 ? (
        <p className="border-maroon bg-surface text-ink border-l-2 px-4 py-3 text-sm">
          <Money cents={model.orphanedRedemptions.amount} className="font-medium" /> in{' '}
          {model.orphanedRedemptions.count} redemption
          {model.orphanedRedemptions.count === 1 ? '' : 's'} does not line up with any current
          period, so it is not counted above. This usually means a card&rsquo;s open date was
          edited after the fact.
        </p>
      ) : null}

      <p className="text-muted text-xs">
        As of <Figure>{model.asOf}</Figure> in {household.timezone}
      </p>
    </div>
  )
}
