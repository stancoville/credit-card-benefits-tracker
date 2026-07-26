/**
 * Cards lens — SPEC §6. A tile per card: capture rate against elapsed pace, card year end,
 * and what is expiring in the next 30 days.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { buildDashboard, type CardSummary } from '@/lib/app/dashboard'
import {
  getDashboardInput,
  getHousehold,
  getProductOptions,
  isDatabaseConfigured,
} from '@/lib/app/queries'
import { NeedsDatabase } from '@/components/needs-database'
import {
  EmptyState,
  Figure,
  Money,
  Panel,
  formatDate,
} from '@/components/primitives'

export const dynamic = 'force-dynamic'

export default async function CardsPage() {
  if (!isDatabaseConfigured()) return <NeedsDatabase />

  const household = await getHousehold()
  if (!household) redirect('/setup')

  const input = await getDashboardInput(household)
  const products = await getProductOptions()
  const model = buildDashboard(input)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="display text-2xl font-semibold">Cards</h1>
          <p className="text-muted mt-1 text-sm">
            {household.name} · {input.cards.length}{' '}
            {input.cards.length === 1 ? 'card' : 'cards'}
          </p>
        </div>
        {products.length > 0 ? (
          <Link
            href="/cards/new"
            className="bg-ink text-paper hover:bg-ink/90 rounded px-3 py-2 text-sm font-medium"
          >
            Add a card
          </Link>
        ) : null}
      </header>

      {products.length === 0 ? (
        <EmptyState title="The catalog is empty.">
          <p>
            Cards are chosen from the catalog in <code>/catalog</code>, and every benefit needs a
            source URL from the issuer&rsquo;s terms before it can be added. See{' '}
            <code>catalog/README.md</code>, then run <code>pnpm seed</code>.
          </p>
        </EmptyState>
      ) : null}

      {input.cards.length === 0 && products.length > 0 ? (
        <EmptyState title="No cards yet.">
          <Link href="/cards/new" className="text-ink font-medium underline">
            Add your first card
          </Link>
        </EmptyState>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {model.cards.map((summary) => (
          <CardTile key={summary.card.id} summary={summary} />
        ))}
      </div>
    </div>
  )
}

function CardTile({ summary }: { summary: CardSummary }) {
  const { card, totals, cardYear, capturedRatio, elapsedRatio, pace } = summary

  return (
    <Panel className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-medium">
            <Link href={`/cards/${card.id}`} className="hover:underline">
              {card.nickname ?? card.productName}
            </Link>
          </h2>
          <p className="text-muted mt-0.5 truncate text-xs">
            {card.nickname ? `${card.productName} · ` : ''}
            {card.ownerDisplayName}
            {card.isAuthorizedUser ? ' · authorized user' : ''}
          </p>
        </div>
        <Ring capturedRatio={capturedRatio} elapsedRatio={elapsedRatio} pace={pace} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-muted text-xs">Captured</dt>
        <dd className="text-teal text-right">
          <Money cents={totals.captured} />
        </dd>
        <dt className="text-muted text-xs">Still available</dt>
        <dd className="text-amber text-right">
          <Money cents={totals.available} />
        </dd>
        <dt className="text-muted text-xs">Forfeited</dt>
        <dd className="text-maroon text-right">
          <Money cents={totals.forfeited} />
        </dd>
      </dl>

      <p className="border-hairline text-muted mt-3 border-t pt-3 text-xs">
        {card.closedOn !== undefined ? (
          <>
            Closed <Figure>{formatDate(card.closedOn, { withYear: true })}</Figure>
          </>
        ) : cardYear?.periodEnd ? (
          <>
            Card year ends <Figure>{formatDate(cardYear.periodEnd, { withYear: true })}</Figure>
          </>
        ) : (
          'No current card year'
        )}
        {summary.atRiskCount > 0 ? (
          <>
            {' · '}
            <span className="text-ink font-medium">
              <Money cents={summary.atRiskValue} /> in {summary.atRiskCount} expiring soon
            </span>
          </>
        ) : null}
      </p>
    </Panel>
  )
}

/** Capture rate against elapsed pace. Ahead → teal, behind → amber (SPEC §4, §6). */
function Ring({
  capturedRatio,
  elapsedRatio,
  pace,
}: {
  capturedRatio: number | null
  elapsedRatio: number
  pace: 'ahead' | 'behind' | 'unknown'
}) {
  const ratio = capturedRatio ?? 0
  const size = 46
  const stroke = 5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const colour = pace === 'ahead' ? 'var(--color-teal)' : 'var(--color-amber)'

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      role="img"
      aria-label={
        capturedRatio === null
          ? 'No potential value to capture yet'
          : `Captured ${Math.round(ratio * 100)}% with ${Math.round(elapsedRatio * 100)}% of the card year elapsed — ${pace}`
      }
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-hairline)"
        strokeWidth={stroke}
      />
      {capturedRatio === null ? null : (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colour}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(1, ratio))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
      {/* Elapsed pace as a tick, so ahead/behind is visible rather than inferred. */}
      <line
        x1={size / 2}
        y1={stroke / 2}
        x2={size / 2}
        y2={stroke + 3}
        stroke="var(--color-ink)"
        strokeWidth={1.5}
        transform={`rotate(${elapsedRatio * 360} ${size / 2} ${size / 2})`}
      />
      <text
        x={size / 2}
        y={size / 2 + 3.5}
        textAnchor="middle"
        className="figure"
        fontSize="10"
        fill="var(--color-ink)"
      >
        {capturedRatio === null ? '—' : `${Math.round(ratio * 100)}%`}
      </text>
    </svg>
  )
}
