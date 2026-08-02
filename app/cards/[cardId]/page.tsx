/**
 * Card drill-in — SPEC §6: the four-way split, excluded, fee recovery, and the perk list.
 *
 * Perks render as a list and are excluded from every total (hard rule 7).
 */

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { asOfFor, getCard, getHousehold, isDatabaseConfigured } from '@/lib/app/queries'
import { NeedsDatabase } from '@/components/needs-database'
import { benefitAppliesToCard, ledgerForCardYear } from '@/lib/ledger'
import { isPeriodClosed, periodFor } from '@/lib/periods'
import { Figure, Money, Panel, SectionHeading, formatDate } from '@/components/primitives'
import { LedgerBar } from '@/components/dashboard-parts'
import { CloseCard, ExclusionToggle } from './card-admin-forms'
import { BenefitRowActions } from '@/components/benefit-row-actions'

export const dynamic = 'force-dynamic'

export default async function CardPage({ params }: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await params

  if (!isDatabaseConfigured()) return <NeedsDatabase />

  const household = await getHousehold()
  if (!household) redirect('/setup')

  const card = await getCard(household.id, cardId)
  if (!card) notFound()

  const asOf = asOfFor(household)
  const tz = household.timezone
  const closedOn = card.closedOn ?? undefined
  const annualFee = card.annualFeeOverride ?? card.product.annualFee
  const excludedIds = new Set(card.exclusions.map((exclusion) => exclusion.benefitId))

  const credits = card.product.benefits.filter((benefit) => benefit.benefitType === 'credit')
  const perks = card.product.benefits.filter((benefit) => benefit.benefitType === 'perk')

  const ledger = ledgerForCardYear({
    card: {
      openedOn: card.openedOn,
      closedOn,
      annualFee,
      isAuthorizedUser: card.isAuthorizedUser,
    },
    benefits: card.product.benefits.map((benefit) => ({
      id: benefit.id,
      benefitType: benefit.benefitType,
      maxValue: benefit.maxValue,
      requiresEnrollment: benefit.requiresEnrollment,
      appliesTo: benefit.appliesTo,
      valueMode: benefit.valueMode,
      resetType: benefit.resetType,
      resetInterval: benefit.resetInterval,
      resetAnchor: benefit.resetAnchor,
      effectiveFrom: benefit.effectiveFrom,
      effectiveTo: benefit.effectiveTo,
    })),
    redemptions: card.redemptions.map((r) => ({
      benefitId: r.benefitId,
      periodStart: r.periodStart,
      amount: r.amount,
    })),
    enrollments: card.enrollments.map((e) => ({
      benefitId: e.benefitId,
      periodStart: e.periodStart,
    })),
    exclusions: [...excludedIds],
    asOf,
    tz,
  })

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-muted text-xs">
            <Link href="/cards" className="hover:text-ink underline">
              Cards
            </Link>
          </p>
          <h1 className="display mt-1 text-2xl font-semibold">
            {card.nickname ?? card.product.name}
          </h1>
          <p className="text-muted mt-1 text-sm">
            {card.product.issuer.name} · {card.product.name} · {card.owner.displayName}
            {card.isAuthorizedUser ? ' · authorized user' : ''}
          </p>
          <p className="text-muted mt-1 text-xs">
            Opened <Figure>{formatDate(card.openedOn, { withYear: true })}</Figure>
            {closedOn ? (
              <>
                {' · closed '}
                <Figure>{formatDate(closedOn, { withYear: true })}</Figure>
              </>
            ) : null}
            {' · fee '}
            <Figure>
              <Money cents={annualFee} />
            </Figure>
            {card.annualFeeOverride !== null ? ' (override)' : ''}
          </p>
        </div>
      </header>

      {ledger ? (
        <>
          <LedgerBar
            totals={ledger.totals}
            excluded={ledger.excluded}
            totalAnnualFees={annualFee}
          />
          <p className="text-muted text-sm">
            Fee recovery{' '}
            <Money
              cents={ledger.feeRecovery}
              className={ledger.feeRecovery >= 0 ? 'text-teal font-medium' : 'text-ink font-medium'}
            />{' '}
            — captured minus the annual fee for the card year ending{' '}
            <Figure>{ledger.cardYear.periodEnd ? formatDate(ledger.cardYear.periodEnd) : '—'}</Figure>
            .
          </p>
        </>
      ) : (
        <p className="text-muted text-sm">
          This card has no current card year{closedOn ? ' because it is closed' : ''}.
        </p>
      )}

      <section>
        <SectionHeading>Credits</SectionHeading>
        {credits.length === 0 ? (
          <p className="text-muted text-sm">This product has no credits in the catalog.</p>
        ) : (
          <Panel>
            <ul className="divide-hairline divide-y">
              {credits.map((benefit) => {
                const excluded = excludedIds.has(benefit.id)
                // SPEC §3.1: still listed, because knowing the product has it is useful —
                // but it carries no value on this card and offers no action.
                const applies = benefitAppliesToCard(benefit.appliesTo, card.isAuthorizedUser)
                const period = applies
                  ? periodFor(benefit, card.openedOn, asOf, { tz, cardClosedOn: closedOn })
                  : null
                const open = period !== null && !isPeriodClosed(period, asOf)

                // Remaining and enrollment are per period, so read them for *this* period
                // rather than assuming a fresh one.
                const captured = period
                  ? card.redemptions
                      .filter((r) => r.benefitId === benefit.id && r.periodStart === period.periodStart)
                      .reduce((sum, r) => sum + r.amount, 0)
                  : 0
                const remaining = Math.max(0, (benefit.maxValue ?? 0) - captured)
                const needsEnrollment =
                  benefit.requiresEnrollment &&
                  period !== null &&
                  !card.enrollments.some(
                    (e) => e.benefitId === benefit.id && e.periodStart === period.periodStart,
                  )

                return (
                  <li key={benefit.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <p className={`text-sm font-medium ${excluded ? 'text-muted line-through' : ''}`}>
                          {benefit.name}
                        </p>
                        <p className="text-muted mt-0.5 text-xs">
                          {captured > 0 ? (
                            <>
                              <Money cents={remaining} className="text-ink" /> left of{' '}
                            </>
                          ) : null}
                          <Money cents={benefit.maxValue ?? 0} /> · {benefit.resetType.replace('_', ' ')}
                          {benefit.resetInterval > 1 ? ` ×${benefit.resetInterval}` : ''} ·{' '}
                          {benefit.resetAnchor === 'calendar' ? 'calendar' : 'card year'}
                          {benefit.requiresEnrollment ? ' · needs enrollment' : ''}
                        </p>
                        {benefit.merchantScope ? (
                          <p className="text-muted mt-0.5 text-xs">{benefit.merchantScope}</p>
                        ) : null}
                        {!applies ? (
                          <p className="text-muted mt-1 text-xs">
                            {benefit.appliesTo === 'primary'
                              ? 'Primary cardholder only — not counted on this card.'
                              : 'Authorized users only — not counted on this card.'}
                          </p>
                        ) : period ? (
                          <p className="text-muted mt-1 text-xs">
                            Current period <Figure>{period.periodStart}</Figure>
                            {period.periodEnd ? (
                              <>
                                {' → '}
                                <Figure>{period.periodEnd}</Figure>
                              </>
                            ) : (
                              ' → no deadline'
                            )}
                          </p>
                        ) : (
                          <p className="text-muted mt-1 text-xs">No active period right now.</p>
                        )}
                        <a
                          href={benefit.sourceUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-muted hover:text-ink mt-1 inline-block text-xs underline"
                        >
                          Issuer terms · verified <Figure>{benefit.verifiedOn}</Figure>
                        </a>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {open && !excluded && (remaining > 0 || needsEnrollment) ? (
                          <BenefitRowActions
                            cardId={card.id}
                            benefitId={benefit.id}
                            benefitName={benefit.name}
                            remaining={remaining}
                            needsEnrollment={needsEnrollment}
                            asOf={asOf}
                          />
                        ) : null}
                        {applies ? (
                          <ExclusionToggle
                            cardId={card.id}
                            benefitId={benefit.id}
                            excluded={excluded}
                          />
                        ) : null}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Panel>
        )}
      </section>

      {perks.length > 0 ? (
        <section>
          <SectionHeading>Perks</SectionHeading>
          <Panel className="px-4 py-3">
            <ul className="text-muted space-y-2 text-sm">
              {perks.map((perk) => (
                <li key={perk.id}>
                  <span className="text-ink">{perk.name}</span>
                  {perk.notes ? ` — ${perk.notes}` : ''}
                </li>
              ))}
            </ul>
            <p className="text-muted mt-3 text-xs">
              Perks never appear in a total. They are listed here because they are part of what
              the fee buys.
            </p>
          </Panel>
        </section>
      ) : null}

      <section>
        <SectionHeading>Card</SectionHeading>
        <CloseCard cardId={card.id} closedOn={closedOn ?? null} today={asOf} />
      </section>
    </div>
  )
}
