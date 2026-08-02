'use server'

/**
 * Server Actions — the only mutation path (CLAUDE.md: no separate API layer in v1).
 *
 * Two rules shape every action here:
 *
 *   1. **`occurred_on` decides the period** (SPEC §4.3). `period_start` is derived by
 *      passing the date to `periodFor`, never accepted from the client, so a redemption's
 *      key can never disagree with its date. A date with no period is rejected, and
 *      `periodFor` returning null *is* that validation.
 *   2. **Errors say what happened and how to fix it** (CLAUDE.md copy rules), which is why
 *      they carry the remaining amount or the reason a date has no period.
 */

import { and, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/db/client'
import {
  benefitExclusions,
  enrollments,
  households,
  redemptions,
  userCards,
  users,
} from '@/db/schema'
import { isValidTimeZone } from '@/lib/date/now'
import { isPlainDate, parsePlainDate, type PlainDate } from '@/lib/date/plain-date'
import { InvalidAmountError, formatCents, parseDollarsToCents } from '@/lib/money'
import { benefitAppliesToCard } from '@/lib/ledger'
import { periodFor } from '@/lib/periods'
import { asOfFor, getCard, getHousehold } from '@/lib/app/queries'

export type ActionResult = { ok: true; message: string } | { ok: false; error: string }

const DEMO_MODE = process.env.DEMO_MODE === 'true'

function text(formData: FormData, field: string): string {
  const value = formData.get(field)
  return typeof value === 'string' ? value.trim() : ''
}

function date(formData: FormData, field: string): PlainDate | null {
  const value = text(formData, field)
  return isPlainDate(value) ? parsePlainDate(value) : null
}

function guardDemo(): ActionResult | null {
  // SPEC §2: demo mode disables anything destructive.
  return DEMO_MODE ? { ok: false, error: 'This is the demo. Changes are turned off here.' } : null
}

/* -------------------------------------------------------------------------- */
/* First-run setup                                                            */
/* -------------------------------------------------------------------------- */

export async function setupHousehold(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const demo = guardDemo()
  if (demo) return demo

  const name = text(formData, 'name')
  const timezone = text(formData, 'timezone')
  const memberNames = formData
    .getAll('memberName')
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value !== '')

  if (name === '') return { ok: false, error: 'Give the household a name.' }
  if (!isValidTimeZone(timezone)) {
    return { ok: false, error: `${timezone || 'That'} is not a timezone. Try America/New_York.` }
  }
  if (memberNames.length === 0) return { ok: false, error: 'Add at least one person.' }

  const existing = await getHousehold()
  if (existing) return { ok: false, error: 'A household already exists.' }

  const db = getDb()
  const [household] = await db
    .insert(households)
    .values({ name, timezone })
    .returning({ id: households.id })
  if (!household) return { ok: false, error: 'Could not create the household. Try again.' }

  const emails = formData.getAll('memberEmail')
  await db.insert(users).values(
    memberNames.map((displayName, index) => {
      const email = emails[index]
      return {
        householdId: household.id,
        displayName,
        email: typeof email === 'string' ? email.trim() : '',
      }
    }),
  )

  revalidatePath('/')
  revalidatePath('/cards')
  return { ok: true, message: 'Household created.' }
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                      */
/* -------------------------------------------------------------------------- */

export async function addCard(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const demo = guardDemo()
  if (demo) return demo

  const household = await getHousehold()
  if (!household) return { ok: false, error: 'Set up your household first.' }

  const productId = text(formData, 'productId')
  const ownerUserId = text(formData, 'ownerUserId')
  const openedOn = date(formData, 'openedOn')
  const nickname = text(formData, 'nickname')
  const feeOverride = text(formData, 'annualFeeOverride')

  if (productId === '') return { ok: false, error: 'Pick a card product.' }
  if (ownerUserId === '') return { ok: false, error: 'Pick who holds this card.' }
  if (!openedOn) return { ok: false, error: 'Enter the date the account was opened.' }

  const asOf = asOfFor(household)
  if (openedOn > asOf) {
    return { ok: false, error: 'The open date is in the future. Use the day the account opened.' }
  }

  let annualFeeOverride: number | null = null
  if (feeOverride !== '') {
    try {
      annualFeeOverride = parseDollarsToCents(feeOverride)
    } catch (error) {
      return {
        ok: false,
        error: error instanceof InvalidAmountError ? error.message : 'Check the annual fee.',
      }
    }
    if (annualFeeOverride < 0) return { ok: false, error: 'The annual fee cannot be negative.' }
  }

  const db = getDb()
  const owner = await db.query.users.findFirst({ where: eq(users.id, ownerUserId) })
  if (!owner || owner.householdId !== household.id) {
    return { ok: false, error: 'That person is not in this household.' }
  }

  await db.insert(userCards).values({
    householdId: household.id,
    productId,
    ownerUserId,
    nickname: nickname === '' ? null : nickname,
    openedOn,
    isAuthorizedUser: formData.get('isAuthorizedUser') === 'on',
    annualFeeOverride,
  })

  revalidatePath('/')
  revalidatePath('/cards')
  return { ok: true, message: 'Card added.' }
}

export async function closeCard(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const demo = guardDemo()
  if (demo) return demo

  const household = await getHousehold()
  if (!household) return { ok: false, error: 'Set up your household first.' }

  const cardId = text(formData, 'cardId')
  const closedOn = date(formData, 'closedOn')
  if (!closedOn) return { ok: false, error: 'Enter the date the account closed.' }

  const card = await getCard(household.id, cardId)
  if (!card) return { ok: false, error: 'That card is not in this household.' }
  if (closedOn < card.openedOn) {
    return { ok: false, error: `The close date is before the card opened (${card.openedOn}).` }
  }

  await getDb().update(userCards).set({ closedOn }).where(eq(userCards.id, cardId))

  revalidatePath('/')
  revalidatePath('/cards')
  return { ok: true, message: 'Card closed.' }
}

export async function reopenCard(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const demo = guardDemo()
  if (demo) return demo

  const household = await getHousehold()
  if (!household) return { ok: false, error: 'Set up your household first.' }

  const cardId = text(formData, 'cardId')
  const card = await getCard(household.id, cardId)
  if (!card) return { ok: false, error: 'That card is not in this household.' }

  await getDb().update(userCards).set({ closedOn: null }).where(eq(userCards.id, cardId))

  revalidatePath('/')
  revalidatePath('/cards')
  return { ok: true, message: 'Card reopened.' }
}

/**
 * Remove a card and everything recorded against it.
 *
 * Deliberately a delete rather than an edit for the open date: `opened_on` anchors every
 * cardmember-year period *and* every period key written to `redemptions`, so changing it in
 * place would orphan the rows filed under the old keys (SPEC §5.3, §4.3). Deleting cascades
 * cleanly through redemptions, enrollments and exclusions; re-adding starts consistent.
 */
export async function deleteCard(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const demo = guardDemo()
  if (demo) return demo

  const household = await getHousehold()
  if (!household) return { ok: false, error: 'Set up your household first.' }

  const cardId = text(formData, 'cardId')
  const card = await getCard(household.id, cardId)
  if (!card) return { ok: false, error: 'That card is not in this household.' }

  const recorded = card.redemptions.length
  await getDb().delete(userCards).where(eq(userCards.id, cardId))

  revalidatePath('/')
  revalidatePath('/cards')
  return {
    ok: true,
    message:
      recorded === 0
        ? 'Card removed.'
        : `Card removed, along with ${recorded} recorded ${recorded === 1 ? 'use' : 'uses'}.`,
  }
}

/* -------------------------------------------------------------------------- */
/* Mark used                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Record a redemption. Defaults to the full remaining amount, so the common case is one
 * gesture (SPEC §6). A backdated `occurredOn` into an already-closed period is supported
 * and is the true-up path in §4.3.
 */
export async function markUsed(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const demo = guardDemo()
  if (demo) return demo

  const household = await getHousehold()
  if (!household) return { ok: false, error: 'Set up your household first.' }

  const cardId = text(formData, 'cardId')
  const benefitId = text(formData, 'benefitId')
  const note = text(formData, 'note')
  const amountInput = text(formData, 'amount')
  const asOf = asOfFor(household)
  const occurredOn = date(formData, 'occurredOn') ?? asOf

  if (occurredOn > asOf) {
    return { ok: false, error: 'That date has not happened yet. Pick today or earlier.' }
  }

  const card = await getCard(household.id, cardId)
  if (!card) return { ok: false, error: 'That card is not in this household.' }

  const benefit = card.product.benefits.find((candidate) => candidate.id === benefitId)
  if (!benefit) return { ok: false, error: 'That benefit is not on this card.' }
  if (benefit.benefitType !== 'credit') {
    return { ok: false, error: 'Perks are not tracked as value, so there is nothing to mark.' }
  }
  if (card.exclusions.some((exclusion) => exclusion.benefitId === benefitId)) {
    return { ok: false, error: 'This benefit is marked as not applicable. Remove that first.' }
  }
  // SPEC §3.1: recording this would create a redemption with no period to live in.
  if (!benefitAppliesToCard(benefit.appliesTo, card.isAuthorizedUser)) {
    return {
      ok: false,
      error: card.isAuthorizedUser
        ? 'This credit only applies to the primary cardholder, not an authorized user card.'
        : 'This credit only applies to authorized user cards.',
    }
  }

  // §4.3: the date decides the period. `periodFor` returning null is the validation.
  const period = periodFor(benefit, card.openedOn, occurredOn, {
    tz: household.timezone,
    cardClosedOn: card.closedOn ?? undefined,
  })
  if (!period) {
    if (occurredOn < card.openedOn) {
      return { ok: false, error: `The card opened on ${card.openedOn}. Pick a later date.` }
    }
    if (card.closedOn && occurredOn > card.closedOn) {
      return { ok: false, error: `The card closed on ${card.closedOn}. Pick an earlier date.` }
    }
    return {
      ok: false,
      error: `This benefit was not active on ${occurredOn}, so there is no period to record it in.`,
    }
  }

  const db = getDb()
  const [used] = await db
    .select({ total: sql<number>`coalesce(sum(${redemptions.amount}), 0)::int` })
    .from(redemptions)
    .where(
      and(
        eq(redemptions.userCardId, cardId),
        eq(redemptions.benefitId, benefitId),
        eq(redemptions.periodStart, period.periodStart),
      ),
    )

  const maxValue = benefit.maxValue ?? 0
  /**
   * SPEC §4.8: for a repeatable benefit `max_value` caps a single use, not the period, so
   * a fourth qualifying stay is as claimable as the first.
   */
  const remaining = benefit.repeatable ? maxValue : maxValue - (used?.total ?? 0)
  if (remaining <= 0) {
    return { ok: false, error: 'This period is already fully used.' }
  }

  let amount = remaining
  if (amountInput !== '') {
    try {
      amount = parseDollarsToCents(amountInput)
    } catch (error) {
      return {
        ok: false,
        error: error instanceof InvalidAmountError ? error.message : 'Check the amount.',
      }
    }
  }

  if (amount <= 0) return { ok: false, error: 'Enter an amount greater than zero.' }
  // §4.3: captured can never exceed max_value, or `available` goes negative.
  if (amount > remaining) {
    return {
      ok: false,
      error: benefit.repeatable
        ? `This benefit pays at most ${formatCents(remaining)} per use. Record each use separately.`
        : `Only ${formatCents(remaining)} is left in this period.`,
    }
  }

  await db.insert(redemptions).values({
    userCardId: cardId,
    benefitId,
    periodStart: period.periodStart,
    amount,
    occurredOn,
    note: note === '' ? null : note,
    source: 'manual',
  })

  revalidatePath('/')
  revalidatePath('/cards')
  revalidatePath(`/cards/${cardId}`)
  return { ok: true, message: `Marked used — ${formatCents(amount)}.` }
}

/* -------------------------------------------------------------------------- */
/* Enroll                                                                     */
/* -------------------------------------------------------------------------- */

/** An unenrolled credit is worth $0 regardless of intent (SPEC §6), so this is its own action. */
export async function enrollBenefit(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const demo = guardDemo()
  if (demo) return demo

  const household = await getHousehold()
  if (!household) return { ok: false, error: 'Set up your household first.' }

  const cardId = text(formData, 'cardId')
  const benefitId = text(formData, 'benefitId')
  const asOf = asOfFor(household)

  const card = await getCard(household.id, cardId)
  if (!card) return { ok: false, error: 'That card is not in this household.' }

  const benefit = card.product.benefits.find((candidate) => candidate.id === benefitId)
  if (!benefit) return { ok: false, error: 'That benefit is not on this card.' }
  if (!benefitAppliesToCard(benefit.appliesTo, card.isAuthorizedUser)) {
    return { ok: false, error: 'This benefit does not apply to this card.' }
  }

  const period = periodFor(benefit, card.openedOn, asOf, {
    tz: household.timezone,
    cardClosedOn: card.closedOn ?? undefined,
  })
  if (!period) {
    return { ok: false, error: 'This benefit has no open period right now.' }
  }

  await getDb()
    .insert(enrollments)
    .values({
      userCardId: cardId,
      benefitId,
      periodStart: period.periodStart,
      enrolledOn: asOf,
    })
    .onConflictDoNothing()

  revalidatePath('/')
  revalidatePath('/cards')
  revalidatePath(`/cards/${cardId}`)
  return { ok: true, message: 'Enrolled.' }
}

/* -------------------------------------------------------------------------- */
/* Exclusions                                                                 */
/* -------------------------------------------------------------------------- */

/** "Not applicable to us." Reported separately, never folded into potential (SPEC §4). */
export async function setExclusion(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const demo = guardDemo()
  if (demo) return demo

  const household = await getHousehold()
  if (!household) return { ok: false, error: 'Set up your household first.' }

  const cardId = text(formData, 'cardId')
  const benefitId = text(formData, 'benefitId')
  const exclude = formData.get('exclude') === 'true'
  const reason = text(formData, 'reason')

  const card = await getCard(household.id, cardId)
  if (!card) return { ok: false, error: 'That card is not in this household.' }

  const db = getDb()
  if (exclude) {
    await db
      .insert(benefitExclusions)
      .values({ userCardId: cardId, benefitId, reason: reason === '' ? null : reason })
      .onConflictDoNothing()
  } else {
    await db
      .delete(benefitExclusions)
      .where(
        and(
          eq(benefitExclusions.userCardId, cardId),
          eq(benefitExclusions.benefitId, benefitId),
        ),
      )
  }

  revalidatePath('/')
  revalidatePath('/cards')
  revalidatePath(`/cards/${cardId}`)
  return { ok: true, message: exclude ? 'Marked not applicable.' : 'Counting it again.' }
}
