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
 * How a benefit's value is determined (SPEC §4.6).
 *
 * `fixed` — `max_value` is a cap set by the issuer. A $100 credit is worth at most $100.
 *
 * `estimated` — the benefit has no dollar cap and its value is *realized at redemption*.
 * A Marriott free night award used on a $500 room captured $500. `max_value` holds a
 * default estimate for planning before it is used, and `estimate_basis` must say where
 * that estimate came from.
 *
 * The split exists because an estimate is not an issuer term. Hard rule 5 keeps invented
 * numbers out of the catalog, so an estimate cannot share a field — or a provenance story —
 * with a verified credit amount.
 */
export const valueModeEnum = pgEnum('value_mode', ['fixed', 'estimated'])

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
  /**
   * Where this issuer shows a card's account open date, shown as help on the add-card form.
   *
   * `opened_on` anchors every cardmember-year period and every redemption key (SPEC §5.2),
   * but almost nobody knows it offhand, and the obvious-looking field is sometimes the wrong
   * one — Amex's "Member Since" is the relationship start, not the card's open date.
   *
   * Navigation guidance, not an amount, so hard rule 5's sourcing requirement does not apply.
   * A stale hint is a mild annoyance; a stale figure is a wrong number.
   */
  accountOpenedHint: text('account_opened_hint'),
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
    /**
     * Integer cents. Null for perks; required for credits (enforced by check below).
     *
     * A cap when `value_mode = 'fixed'`; a default estimate when `'estimated'`.
     */
    maxValue: integer('max_value'),
    valueMode: valueModeEnum('value_mode').notNull().default('fixed'),
    /**
     * Qualifying spend required inside the benefit's own period before its value exists at
     * all (SPEC §4.7). Null means unconditional.
     *
     * A Marriott Bevy free night needs $15,000 of calendar-year spend. That value is real
     * and worth showing, but it is not `available` — it may be permanently out of reach —
     * so it is reported as `unlockable`, outside the four-way split.
     */
    unlockSpend: integer('unlock_spend'),
    /**
     * True when the benefit can be claimed any number of times within its period, with
     * `max_value` acting as a **per-use** cap rather than a period allowance (SPEC §4.8).
     *
     * A Ritz-Carlton property credit pays up to $100 on every qualifying stay. There is no
     * fixed amount to forfeit, so such a benefit contributes exactly what has actually been
     * captured and never sits in `available`.
     */
    repeatable: boolean('repeatable').notNull().default(false),
    /**
     * Integer cents. The most a single redemption can pay, inside a period allowance that
     * stays `max_value` (SPEC §4.9). Null means one redemption may take the whole allowance.
     *
     * The Sapphire Reserve's Edit credit is $500 a calendar year, but each qualifying stay
     * pays at most $250 — so it takes two stays to use it all. Unlike `repeatable`, the
     * allowance is real and the unused part still forfeits.
     */
    perUseCap: integer('per_use_cap'),
    /**
     * Where an estimated value came from — required when `value_mode = 'estimated'`, and
     * shown wherever the estimate is used. An estimate with no stated basis is a guess.
     */
    estimateBasis: text('estimate_basis'),
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
      'benefits_unlock_spend_non_negative',
      sql`${table.unlockSpend} is null or ${table.unlockSpend} >= 0`,
    ),
    // Only credits carry value, so only credits can have that value gated behind spend.
    check(
      'benefits_repeatable_must_be_credit',
      sql`${table.repeatable} = false or ${table.benefitType} = 'credit'`,
    ),
    // §4.9: a per-use cap splits a fixed allowance. A repeatable benefit already treats
    // max_value as its per-use cap, and a cap above the allowance would never bind.
    check(
      'benefits_per_use_cap_valid',
      sql`${table.perUseCap} is null or (${table.benefitType} = 'credit' and ${table.repeatable} = false and ${table.perUseCap} > 0 and ${table.perUseCap} <= ${table.maxValue})`,
    ),
    check(
      'benefits_unlock_spend_must_be_credit',
      sql`${table.unlockSpend} is null or ${table.benefitType} = 'credit'`,
    ),
    // An estimate with no stated basis is exactly the plausible number hard rule 5 forbids.
    check(
      'benefits_estimated_requires_basis',
      sql`${table.valueMode} <> 'estimated' or ${table.estimateBasis} is not null`,
    ),
    // Only credits carry value at all, so only credits can have their value estimated.
    check(
      'benefits_estimated_must_be_credit',
      sql`${table.valueMode} <> 'estimated' or ${table.benefitType} = 'credit'`,
    ),
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
/* 3.3 Gate — the household PIN's attempt log (SPEC §10)                      */
/* -------------------------------------------------------------------------- */

/**
 * One row per PIN submission, so wrong guesses can be limited across serverless instances
 * (lib/gate/limit.ts). Not tied to a household: attempts happen before anyone is known.
 * Rows older than a day are pruned on each attempt; only the last hour is ever read.
 */
export const unlockAttempts = pgTable(
  'unlock_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ip: text('ip').notNull(),
    succeeded: boolean('succeeded').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('unlock_attempts_attempted_at_idx').on(table.attemptedAt),
    index('unlock_attempts_ip_attempted_at_idx').on(table.ip, table.attemptedAt),
  ],
)

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
export type ValueMode = (typeof valueModeEnum.enumValues)[number]
export type ResetType = (typeof resetTypeEnum.enumValues)[number]
export type ResetAnchor = (typeof resetAnchorEnum.enumValues)[number]
export type AppliesTo = (typeof appliesToEnum.enumValues)[number]
