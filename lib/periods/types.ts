/**
 * Types for the period engine (SPEC §5).
 *
 * Deliberately decoupled from the Drizzle row type: the engine takes only the fields it
 * actually needs, so it can be called with a catalog JSON entry, a DB row, or a test
 * fixture. It never touches the database.
 */

import type { PlainDate } from '@/lib/date/plain-date'
import type { ResetAnchor, ResetType } from '@/db/schema'

export type { ResetAnchor, ResetType }

/**
 * The subset of a benefit definition that determines its periods.
 *
 * Structurally satisfied by `typeof benefits.$inferSelect`, so a DB row can be passed
 * directly.
 */
export interface PeriodBenefit {
  readonly resetType: ResetType
  /** n periods; `monthly` with interval 3 is every three months (SPEC §5.2). */
  readonly resetInterval: number
  readonly resetAnchor: ResetAnchor
  readonly effectiveFrom: PlainDate
  readonly effectiveTo: PlainDate | null
}

/**
 * Card- and household-scoped state the calendar alone cannot supply.
 *
 * This is the fourth argument added to SPEC §5.1's signature. Without it, two §5.3 edge
 * cases are unreachable from a pure function: a closed card has no periods after
 * closure, and an already-redeemed `one_time` benefit has no period at all. The caller
 * resolves both and passes them in, so the engine stays pure and both cases stay
 * testable here rather than leaking into the ledger.
 */
export interface PeriodContext {
  /**
   * The household's IANA timezone (SPEC §5.4).
   *
   * Accepted for parity with the §5.1 signature but never read: `asOf` is already a
   * calendar date resolved in this zone by `lib/date/now.ts`, so there is no instant
   * left to interpret. Kept so callers cannot forget which zone the dates came from.
   */
  readonly tz: string
  /** `user_cards.closed_on`. No periods exist after this date (SPEC §5.3). */
  readonly cardClosedOn?: PlainDate | undefined
  /**
   * Whether a `one_time` benefit has already been redeemed on this card.
   * When true, `periodFor` returns null and `periodsInRange` returns [] (SPEC §5.3).
   */
  readonly oneTimeRedeemed?: boolean | undefined
}

/** A single computed benefit period. Never persisted as a row (SPEC §3, §5). */
export interface BenefitPeriod {
  /**
   * Inclusive first day, and the key written to `redemptions.period_start` /
   * `enrollments.period_start`.
   *
   * Clamped to the card's open date and the benefit's `effective_from`, so a card opened
   * mid-period yields a **short first period** rather than a skipped one (SPEC §5.3).
   */
  readonly periodStart: PlainDate
  /**
   * Inclusive last day, clamped by `effective_to` and `closed_on`.
   *
   * Null only for a `one_time` benefit with no `effective_to` and no card closure: such
   * an offer has no deadline, so its period never closes and can never be forfeited.
   * This widens §5.1's return type, which assumed every period ends.
   */
  readonly periodEnd: PlainDate | null
  /**
   * True when either boundary was clamped — by the card's open date, its closure, or the
   * benefit's effective window.
   *
   * Informational only. A partial period still counts its **full** `max_value`: issuers
   * don't prorate (SPEC §5.3).
   */
  readonly isPartial: boolean
}

export class InvalidBenefitDefinitionError extends Error {
  constructor(detail: string) {
    super(`Invalid benefit definition: ${detail}`)
    this.name = 'InvalidBenefitDefinitionError'
  }
}
