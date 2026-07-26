/**
 * Drizzle schema — SPEC §3.
 *
 * Two rules govern every column here:
 *
 *   1. Money is integer cents (CLAUDE.md hard rule 1). Columns are `integer`, named
 *      without a unit suffix to match SPEC §3, and formatted only at the render boundary.
 *   2. Anything that is a calendar date is Postgres `date`, typed as {@link PlainDate}
 *      (hard rule 2). `timestamptz` appears only for true instants — row creation audit
 *      stamps — never for a benefit period boundary.
 *
 * There is deliberately **no `benefit_periods` table** (SPEC §3, §5). Periods are
 * computed by /lib/periods from the benefit definition plus `user_cards.opened_on`.
 * `redemptions.period_start` and `enrollments.period_start` store the *result* of that
 * computation as a key; they do not materialize a period table.
 */

import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { PlainDate } from '@/lib/date/plain-date'

/** `date` column carrying the PlainDate brand, so no conversion layer is needed. */
function calendarDate(name: string) {
  return date(name, { mode: 'string' }).$type<PlainDate>()
}

/** Row-creation audit stamp. A real instant, so `timestamptz` is correct here. */
function createdAt(name = 'created_at') {
  return timestamp(name, { withTimezone: true, mode: 'string' }).notNull().defaultNow()
}

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */

/** SPEC §3.1. Only `credit` participates in ledger math (hard rule 7). */
export const benefitTypeEnum = pgEnum('benefit_type', ['credit', 'perk'])

/** SPEC §5.2. */
export const resetTypeEnum = pgEnum('reset_type', [
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
  'rolling',
  'one_time',
])

/**
 * SPEC §5.2. `one_time` benefits never reset, so their anchor is meaningless — the
 * column stays `not null` and the engine ignores it for that reset type.
 */
export const resetAnchorEnum = pgEnum('reset_anchor', ['calendar', 'card_open'])

/** SPEC §3.1. */
export const appliesToEnum = pgEnum('applies_to', ['primary', 'authorized_user', 'both'])

/**
 * How a redemption came to be recorded (SPEC §10).
 *
 * Email reminders are deferred from v1, but the column ships now: adding a column later
 * is trivial, while recovering the *meaning* of rows written before it existed is not —
 * they would be permanently ambiguous between "entered by hand" and "unknown". Postgres
 * can gain further values with `ALTER TYPE ... ADD VALUE`, so the list stays minimal.
 */
export const redemptionSourceEnum = pgEnum('redemption_source', ['manual', 'reminder'])

/* -------------------------------------------------------------------------- */
/* 3.1 Catalog tables — seeded from the repo, identical for every deployment   */
/* -------------------------------------------------------------------------- */

export const issuers = pgTable('issuers', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
})

export const cardProducts = pgTable(
  'card_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issuerId: uuid('issuer_id')
      .notNull()
      .references(() => issuers.id, { onDelete: 'restrict' }),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    /** Integer cents. */
    annualFee: integer('annual_fee').notNull(),
    effectiveFrom: calendarDate('effective_from').notNull(),
    effectiveTo: calendarDate('effective_to'),
  },
  (table) => [
    index('card_products_issuer_idx').on(table.issuerId),
    check('card_products_annual_fee_non_negative', sql`${table.annualFee} >= 0`),
    check(
      'card_products_effective_window_ordered',
      sql`${table.effectiveTo} is null or ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
  ],
)

export const benefits = pgTable(
  'benefits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => cardProducts.id, { onDelete: 'cascade' }),
    /** Unique per (product, effective window) — see the unique index below. */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    benefitType: benefitTypeEnum('benefit_type').notNull(),
    /** Integer cents. Null for perks; required for credits (enforced by check below). */
    maxValue: integer('max_value'),
    resetType: resetTypeEnum('reset_type').notNull(),
    /** Multiplies the base period: `monthly` with interval 3 is every three months. */
    resetInterval: integer('reset_interval').notNull().default(1),
    resetAnchor: resetAnchorEnum('reset_anchor').notNull(),
    requiresEnrollment: boolean('requires_enrollment').notNull().default(false),
    appliesTo: appliesToEnum('applies_to').notNull(),
    /** Free text, e.g. 'Uber Eats and rides'. */
    merchantScope: text('merchant_scope'),
    notes: text('notes'),
    /** Issuer T&C. Required — CLAUDE.md hard rule 5. */
    sourceUrl: text('source_url').notNull(),
    /** Date the amount was checked against issuer terms. Required — hard rule 5. */
    verifiedOn: calendarDate('verified_on').notNull(),
    effectiveFrom: calendarDate('effective_from').notNull(),
    effectiveTo: calendarDate('effective_to'),
  },
  (table) => [
    // Matches the idempotent seed upsert key in SPEC §7.
    uniqueIndex('benefits_product_slug_effective_from_key').on(
      table.productId,
      table.slug,
      table.effectiveFrom,
    ),
    index('benefits_product_idx').on(table.productId),
    check('benefits_max_value_non_negative', sql`${table.maxValue} >= 0`),
    // Hard rule 7 / SPEC §3.1: a credit without a value cannot enter ledger math.
    check(
      'benefits_credit_requires_max_value',
      sql`${table.benefitType} <> 'credit' or ${table.maxValue} is not null`,
    ),
    check('benefits_reset_interval_positive', sql`${table.resetInterval} >= 1`),
    check(
      'benefits_effective_window_ordered',
      sql`${table.effectiveTo} is null or ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
  ],
)

/* -------------------------------------------------------------------------- */
/* 3.2 Ledger tables — Neon only, never in the repo                           */
/* -------------------------------------------------------------------------- */

export const households = pgTable('households', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** IANA zone, e.g. 'America/New_York'. Every period boundary is evaluated here (§5.4). */
  timezone: text('timezone').notNull(),
  createdAt: createdAt(),
})

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    email: text('email').notNull(),
    // No auth columns in v1 (SPEC §3.2); they get added later without touching anything else.
    createdAt: createdAt(),
  },
  (table) => [index('users_household_idx').on(table.householdId)],
)

export const userCards = pgTable(
  'user_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => cardProducts.id, { onDelete: 'restrict' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    nickname: text('nickname'),
    /** Anchors all cardmember-year periods (SPEC §5.2, §4). */
    openedOn: calendarDate('opened_on').notNull(),
    closedOn: calendarDate('closed_on'),
    isAuthorizedUser: boolean('is_authorized_user').notNull().default(false),
    /** Integer cents; overrides the product's annual fee for this household. */
    annualFeeOverride: integer('annual_fee_override'),
    createdAt: createdAt(),
  },
  (table) => [
    index('user_cards_household_idx').on(table.householdId),
    index('user_cards_product_idx').on(table.productId),
    index('user_cards_owner_idx').on(table.ownerUserId),
    check(
      'user_cards_closed_after_opened',
      sql`${table.closedOn} is null or ${table.closedOn} >= ${table.openedOn}`,
    ),
    check(
      'user_cards_annual_fee_override_non_negative',
      sql`${table.annualFeeOverride} is null or ${table.annualFeeOverride} >= 0`,
    ),
  ],
)

/** "Not applicable to us." Reported separately; never folded into `potential` (SPEC §4). */
export const benefitExclusions = pgTable(
  'benefit_exclusions',
  {
    userCardId: uuid('user_card_id')
      .notNull()
      .references(() => userCards.id, { onDelete: 'cascade' }),
    benefitId: uuid('benefit_id')
      .notNull()
      .references(() => benefits.id, { onDelete: 'cascade' }),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userCardId, table.benefitId] }),
    index('benefit_exclusions_benefit_idx').on(table.benefitId),
  ],
)

/**
 * An unenrolled credit is worth $0 regardless of intent (SPEC §6). Enrollment is per
 * period, so `period_start` is a computed period key — not a row in a period table.
 */
export const enrollments = pgTable(
  'enrollments',
  {
    userCardId: uuid('user_card_id')
      .notNull()
      .references(() => userCards.id, { onDelete: 'cascade' }),
    benefitId: uuid('benefit_id')
      .notNull()
      .references(() => benefits.id, { onDelete: 'cascade' }),
    /** Computed by /lib/periods, stored as a key. */
    periodStart: calendarDate('period_start').notNull(),
    enrolledOn: calendarDate('enrolled_on').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userCardId, table.benefitId, table.periodStart] }),
    index('enrollments_benefit_idx').on(table.benefitId),
  ],
)

export const redemptions = pgTable(
  'redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userCardId: uuid('user_card_id')
      .notNull()
      .references(() => userCards.id, { onDelete: 'cascade' }),
    benefitId: uuid('benefit_id')
      .notNull()
      .references(() => benefits.id, { onDelete: 'cascade' }),
    /**
     * Computed by /lib/periods, stored as a key — not a period table (SPEC §3.2).
     *
     * Always derived server-side from `occurred_on` via `periodFor`, never accepted from
     * the client. That is what makes a backdated "true up" into an already-closed period
     * safe: the date decides the period, so the key cannot disagree with it (SPEC §4).
     */
    periodStart: calendarDate('period_start').notNull(),
    /** Integer cents. Partial usage is normal. */
    amount: integer('amount').notNull(),
    /** When the credit was actually used. May fall in a closed period — see SPEC §4. */
    occurredOn: calendarDate('occurred_on').notNull(),
    /** Free text, e.g. which hotel the credit was used at. */
    note: text('note'),
    source: redemptionSourceEnum('source').notNull().default('manual'),
    createdAt: createdAt(),
  },
  (table) => [
    index('redemptions_card_benefit_period_idx').on(
      table.userCardId,
      table.benefitId,
      table.periodStart,
    ),
    check('redemptions_amount_non_negative', sql`${table.amount} >= 0`),
  ],
)

/* -------------------------------------------------------------------------- */
/* Relations                                                                  */
/* -------------------------------------------------------------------------- */

export const issuersRelations = relations(issuers, ({ many }) => ({
  products: many(cardProducts),
}))

export const cardProductsRelations = relations(cardProducts, ({ one, many }) => ({
  issuer: one(issuers, { fields: [cardProducts.issuerId], references: [issuers.id] }),
  benefits: many(benefits),
  userCards: many(userCards),
}))

export const benefitsRelations = relations(benefits, ({ one, many }) => ({
  product: one(cardProducts, { fields: [benefits.productId], references: [cardProducts.id] }),
  exclusions: many(benefitExclusions),
  enrollments: many(enrollments),
  redemptions: many(redemptions),
}))

export const householdsRelations = relations(households, ({ many }) => ({
  users: many(users),
  cards: many(userCards),
}))

export const usersRelations = relations(users, ({ one, many }) => ({
  household: one(households, { fields: [users.householdId], references: [households.id] }),
  ownedCards: many(userCards),
}))

export const userCardsRelations = relations(userCards, ({ one, many }) => ({
  household: one(households, { fields: [userCards.householdId], references: [households.id] }),
  product: one(cardProducts, { fields: [userCards.productId], references: [cardProducts.id] }),
  owner: one(users, { fields: [userCards.ownerUserId], references: [users.id] }),
  exclusions: many(benefitExclusions),
  enrollments: many(enrollments),
  redemptions: many(redemptions),
}))

export const benefitExclusionsRelations = relations(benefitExclusions, ({ one }) => ({
  userCard: one(userCards, {
    fields: [benefitExclusions.userCardId],
    references: [userCards.id],
  }),
  benefit: one(benefits, { fields: [benefitExclusions.benefitId], references: [benefits.id] }),
}))

export const enrollmentsRelations = relations(enrollments, ({ one }) => ({
  userCard: one(userCards, { fields: [enrollments.userCardId], references: [userCards.id] }),
  benefit: one(benefits, { fields: [enrollments.benefitId], references: [benefits.id] }),
}))

export const redemptionsRelations = relations(redemptions, ({ one }) => ({
  userCard: one(userCards, { fields: [redemptions.userCardId], references: [userCards.id] }),
  benefit: one(benefits, { fields: [redemptions.benefitId], references: [benefits.id] }),
}))

/* -------------------------------------------------------------------------- */
/* Inferred row types                                                         */
/* -------------------------------------------------------------------------- */

export type Issuer = typeof issuers.$inferSelect
export type NewIssuer = typeof issuers.$inferInsert
export type CardProduct = typeof cardProducts.$inferSelect
export type NewCardProduct = typeof cardProducts.$inferInsert
export type Benefit = typeof benefits.$inferSelect
export type NewBenefit = typeof benefits.$inferInsert
export type Household = typeof households.$inferSelect
export type NewHousehold = typeof households.$inferInsert
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type UserCard = typeof userCards.$inferSelect
export type NewUserCard = typeof userCards.$inferInsert
export type BenefitExclusion = typeof benefitExclusions.$inferSelect
export type NewBenefitExclusion = typeof benefitExclusions.$inferInsert
export type Enrollment = typeof enrollments.$inferSelect
export type NewEnrollment = typeof enrollments.$inferInsert
export type Redemption = typeof redemptions.$inferSelect
export type NewRedemption = typeof redemptions.$inferInsert

export type BenefitType = (typeof benefitTypeEnum.enumValues)[number]
export type RedemptionSource = (typeof redemptionSourceEnum.enumValues)[number]
export type ResetType = (typeof resetTypeEnum.enumValues)[number]
export type ResetAnchor = (typeof resetAnchorEnum.enumValues)[number]
export type AppliesTo = (typeof appliesToEnum.enumValues)[number]
