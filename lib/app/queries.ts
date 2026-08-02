/**
 * Server-side data loading. The only module that both talks to the database and knows about
 * the view model — everything downstream is pure.
 *
 * There is no auth in v1 (SPEC §3.2), so "the household" is the single household row. That
 * is deliberate and documented rather than implied: when auth lands, this is the one
 * function that changes.
 */

import { asc, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '@/db/client'
import {
  benefitExclusions,
  benefits,
  cardProducts,
  enrollments,
  households,
  issuers,
  redemptions,
  userCards,
  users,
} from '@/db/schema'
import { todayIn } from '@/lib/date/now'
import type { PlainDate } from '@/lib/date/plain-date'
import type { DashboardCard, DashboardInput } from './dashboard'

export interface Household {
  id: string
  name: string
  timezone: string
}

export interface Member {
  id: string
  displayName: string
  email: string
}

export interface ProductOption {
  id: string
  slug: string
  name: string
  /** Stable key for grouping — issuer display names can change, slugs don't. */
  issuerSlug: string
  issuerName: string
  annualFee: number
  /** Counts shown in the picker so a near-identical product can be told apart. */
  creditCount: number
  perkCount: number
}

/**
 * Whether a database is configured at all.
 *
 * A fresh clone has no `DATABASE_URL`, and a stack trace is a poor first thing to show
 * someone self-hosting this. Every entry route checks this before querying.
 */
export function isDatabaseConfigured(): boolean {
  const url = process.env.DATABASE_URL
  return typeof url === 'string' && url.trim() !== ''
}

/** The household, or null on a fresh install (which sends the user to /setup). */
export async function getHousehold(): Promise<Household | null> {
  const rows = await getDb()
    .select({ id: households.id, name: households.name, timezone: households.timezone })
    .from(households)
    .orderBy(asc(households.createdAt))
    .limit(1)
  return rows[0] ?? null
}

export async function getMembers(householdId: string): Promise<Member[]> {
  return getDb()
    .select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .where(eq(users.householdId, householdId))
    .orderBy(asc(users.createdAt))
}

/**
 * Catalog products available to add, with the counts the picker shows. Empty until the
 * catalog is seeded (SPEC §7).
 */
export async function getProductOptions(): Promise<ProductOption[]> {
  return getDb()
    .select({
      id: cardProducts.id,
      slug: cardProducts.slug,
      name: cardProducts.name,
      issuerSlug: issuers.slug,
      issuerName: issuers.name,
      annualFee: cardProducts.annualFee,
      creditCount: sql<number>`count(*) filter (where ${benefits.benefitType} = 'credit')::int`,
      perkCount: sql<number>`count(*) filter (where ${benefits.benefitType} = 'perk')::int`,
    })
    .from(cardProducts)
    .innerJoin(issuers, eq(cardProducts.issuerId, issuers.id))
    .leftJoin(benefits, eq(benefits.productId, cardProducts.id))
    .groupBy(cardProducts.id, issuers.slug, issuers.name)
    .orderBy(asc(issuers.name), asc(cardProducts.name))
}

/** `asOf` derived server-side from the household timezone, never the browser (SPEC §5.4). */
export function asOfFor(household: Household): PlainDate {
  return todayIn(household.timezone)
}

/**
 * Everything the dashboard and cards lens need, in one pass.
 *
 * Loads the whole household rather than paginating: a household holds a handful of cards,
 * and the period engine needs every benefit anyway to compute a total that reconciles.
 */
export async function getDashboardInput(household: Household): Promise<DashboardInput> {
  const db = getDb()

  const cardRows = await db.query.userCards.findMany({
    where: eq(userCards.householdId, household.id),
    with: {
      product: { with: { benefits: true } },
      owner: true,
      exclusions: true,
    },
    orderBy: [asc(userCards.openedOn)],
  })

  const cardIds = cardRows.map((row) => row.id)

  const [redemptionRows, enrollmentRows] = cardIds.length
    ? await Promise.all([
        db
          .select({
            userCardId: redemptions.userCardId,
            benefitId: redemptions.benefitId,
            periodStart: redemptions.periodStart,
            amount: redemptions.amount,
          })
          .from(redemptions)
          .where(inArray(redemptions.userCardId, cardIds)),
        db
          .select({
            userCardId: enrollments.userCardId,
            benefitId: enrollments.benefitId,
            periodStart: enrollments.periodStart,
          })
          .from(enrollments)
          .where(inArray(enrollments.userCardId, cardIds)),
      ])
    : [[], []]

  const cards: DashboardCard[] = cardRows.map((row) => ({
    id: row.id,
    productName: row.product.name,
    nickname: row.nickname,
    ownerDisplayName: row.owner.displayName,
    openedOn: row.openedOn,
    closedOn: row.closedOn ?? undefined,
    // The household's override wins over the catalog fee.
    annualFee: row.annualFeeOverride ?? row.product.annualFee,
    isAuthorizedUser: row.isAuthorizedUser,
    excludedBenefitIds: row.exclusions.map((exclusion) => exclusion.benefitId),
    benefits: row.product.benefits.map((benefit) => ({
      id: benefit.id,
      name: benefit.name,
      merchantScope: benefit.merchantScope,
      benefitType: benefit.benefitType,
      maxValue: benefit.maxValue,
      requiresEnrollment: benefit.requiresEnrollment,
      appliesTo: benefit.appliesTo,
      valueMode: benefit.valueMode,
      estimateBasis: benefit.estimateBasis,
      unlockSpend: benefit.unlockSpend,
      repeatable: benefit.repeatable,
      resetType: benefit.resetType,
      resetInterval: benefit.resetInterval,
      resetAnchor: benefit.resetAnchor,
      effectiveFrom: benefit.effectiveFrom,
      effectiveTo: benefit.effectiveTo,
    })),
  }))

  return {
    cards,
    redemptions: redemptionRows,
    enrollments: enrollmentRows,
    asOf: asOfFor(household),
    tz: household.timezone,
  }
}

/**
 * One card with everything the drill-in needs — including its redemptions and enrollments,
 * without which the four-way split would report zero captured.
 */
export async function getCard(householdId: string, cardId: string) {
  const row = await getDb().query.userCards.findFirst({
    where: eq(userCards.id, cardId),
    with: {
      product: { with: { benefits: true, issuer: true } },
      owner: true,
      exclusions: true,
      redemptions: true,
      enrollments: true,
    },
  })
  if (!row || row.householdId !== householdId) return null
  return row
}

export async function getExclusions(cardId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ benefitId: benefitExclusions.benefitId })
    .from(benefitExclusions)
    .where(eq(benefitExclusions.userCardId, cardId))
  return rows.map((row) => row.benefitId)
}
