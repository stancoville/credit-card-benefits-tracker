/**
 * Generates a verification checklist from the catalog.
 *
 * The catalog is community-maintained and every figure is a claim about a real issuer's
 * terms. This turns it into something a human can sit down and work through, ordered by how
 * badly a wrong entry would mislead someone.
 *
 *   pnpm review              # print the checklist
 *   pnpm review > REVIEW.md  # or write it somewhere
 */

import { loadCatalog } from '@/lib/catalog'
import { formatCents } from '@/lib/money'

type Risk = 'high' | 'medium' | 'low'

interface Item {
  readonly product: string
  readonly fee: number
  readonly benefit: string
  readonly detail: string
  readonly sourceUrl: string
  readonly verifiedOn: string
  readonly risk: Risk
  readonly why: readonly string[]
}

const RESET_LABEL: Record<string, string> = {
  monthly: 'monthly',
  quarterly: 'quarterly',
  semiannual: 'semiannual',
  annual: 'annual',
  rolling: 'rolling',
  one_time: 'one-time',
}

function main(): void {
  const catalog = loadCatalog({ includeTemplates: false })
  const items: Item[] = []

  for (const { file } of catalog.products) {
    for (const entry of file.benefits) {
      const why: string[] = []
      let risk: Risk = 'low'

      const isCredit = entry.benefit_type === 'credit'
      const amount = isCredit ? entry.max_value_cents : null
      const estimated = isCredit && entry.value_mode === 'estimated'
      const gated = isCredit && entry.unlock_spend_cents !== undefined
      const repeatable = isCredit && entry.repeatable

      if ((entry.notes ?? '').includes('TODO')) {
        why.push('carries a TODO — something could not be confirmed')
        risk = 'high'
      }
      if (estimated) {
        why.push('value is an estimate, not an issuer figure')
        if (risk !== 'high') risk = 'high'
      }
      // A large amount on a long period is the most expensive kind of mistake: it is a big
      // number that only proves wrong once a year.
      if (isCredit && (amount ?? 0) >= 20000 && ['annual', 'semiannual', 'rolling'].includes(entry.reset_type)) {
        why.push('large amount on a long period — an error here is both big and slow to surface')
        if (risk === 'low') risk = 'medium'
      }
      if (isCredit && entry.reset_anchor === 'card_open') {
        why.push('cardmember-year anchored — check it is not actually a calendar year')
        if (risk === 'low') risk = 'medium'
      }
      if (isCredit && entry.requires_enrollment) {
        why.push('enrollment required — check this is still true, it changes the UI state')
      }
      if (gated) why.push('spend threshold — check the amount and the qualifying window')
      if (repeatable) why.push('per-use rather than per-period — check there is no annual cap')
      if (!isCredit) why.push('perk — check it really carries no trackable dollar value')

      const detail = isCredit
        ? `${formatCents(amount ?? 0)}${repeatable ? ' per use' : ''} · ${RESET_LABEL[entry.reset_type]} · ${
            entry.reset_anchor === 'calendar' ? 'calendar' : 'card year'
          }${estimated ? ' · ESTIMATED' : ''}${gated ? ` · unlocks at ${formatCents(entry.unlock_spend_cents ?? 0)}` : ''}`
        : 'perk — no dollar value'

      items.push({
        product: file.product.name,
        fee: file.product.annual_fee_cents,
        benefit: entry.name,
        detail,
        sourceUrl: entry.source_url,
        verifiedOn: entry.verified_on,
        risk,
        why,
      })
    }
  }

  const order: Risk[] = ['high', 'medium', 'low']
  const counts = Object.fromEntries(order.map((r) => [r, items.filter((i) => i.risk === r).length]))

  console.log('# Catalog review checklist\n')
  console.log(
    `${items.length} benefits across ${catalog.products.length} products. ` +
      `${counts.high} high priority, ${counts.medium} medium, ${counts.low} low.\n`,
  )
  console.log(
    'Ordered by how badly a wrong entry would mislead someone. Open the source link, check the\n' +
      'figure and the reset period, and update `verified_on` when you have.\n',
  )

  for (const risk of order) {
    const group = items.filter((item) => item.risk === risk)
    if (group.length === 0) continue

    const heading =
      risk === 'high'
        ? 'High — estimates and unconfirmed figures'
        : risk === 'medium'
          ? 'Medium — large amounts, long periods, cardmember-year anchors'
          : 'Low — small or frequently-recurring amounts, and perks'
    console.log(`\n## ${heading}\n`)

    let lastProduct = ''
    for (const item of group.sort((a, b) => a.product.localeCompare(b.product))) {
      if (item.product !== lastProduct) {
        console.log(`\n### ${item.product} — ${formatCents(item.fee)}/yr\n`)
        lastProduct = item.product
      }
      console.log(`- [ ] **${item.benefit}** — ${item.detail}`)
      for (const reason of item.why) console.log(`      - ${reason}`)
      console.log(`      - source: ${item.sourceUrl}`)
      console.log(`      - last verified: ${item.verifiedOn}`)
    }
  }
}

main()
