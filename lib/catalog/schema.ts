/**
 * Zod schema for the catalog JSON in SPEC §7.
 *
 * The catalog is the open-source asset, so this validator is the thing standing between a
 * community PR and a wrong number on someone's dashboard. It is deliberately strict:
 *
 *   - Enum values come from `/db/schema.ts`, so the catalog cannot drift from the DB.
 *   - Every object is `strictObject`, so an unknown key is an error rather than silently
 *     ignored. That is what keeps a `logo_url` or `card_art` field from ever landing
 *     (CLAUDE.md hard rule 6), and it catches typos like `max_value_cent`.
 *   - `source_url` and `verified_on` are required on every benefit (hard rule 5, §7).
 *   - Money is `int()`, so `695.5` is rejected. A float in a cents field is a unit error.
 *   - A credit must carry a value; a perk must not. Only credits enter ledger math
 *     (hard rule 7), so a valueless credit or a valued perk is incoherent.
 */

import { z } from 'zod'
import {
  appliesToEnum,
  benefitTypeEnum,
  resetAnchorEnum,
  resetTypeEnum,
} from '@/db/schema'
import { isPlainDate, parsePlainDate, type PlainDate } from '@/lib/date/plain-date'

/** Lowercase kebab-case, e.g. 'amex-platinum-consumer'. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const slug = z
  .string()
  .min(1)
  .regex(SLUG, 'must be lowercase kebab-case, e.g. amex-platinum-consumer')

const plainDate: z.ZodType<PlainDate, string> = z
  .string()
  .refine(isPlainDate, 'must be a real calendar date in YYYY-MM-DD form')
  .transform((value) => parsePlainDate(value))

/** Integer cents. Never a float, never dollars (hard rule 1). */
const cents = z
  .number()
  .int('money must be integer cents — 695.50 dollars is 69550')
  .min(0)

const name = z.string().min(1).trim()

const benefitBase = {
  slug,
  name,
  reset_type: z.enum(resetTypeEnum.enumValues),
  reset_interval: z.number().int().min(1).default(1),
  reset_anchor: z.enum(resetAnchorEnum.enumValues),
  requires_enrollment: z.boolean().default(false),
  applies_to: z.enum(appliesToEnum.enumValues),
  merchant_scope: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
  /** Issuer terms & conditions. Required — hard rule 5. */
  source_url: z.url('must be a link to the issuer terms this amount came from'),
  /** When a human last checked this against those terms. Required — hard rule 5. */
  verified_on: plainDate,
  effective_from: plainDate,
  effective_to: plainDate.nullish(),
} as const

const creditBenefit = z.strictObject({
  ...benefitBase,
  benefit_type: z.literal(benefitTypeEnum.enumValues[0]),
  /** Required for credits: a credit with no value cannot enter ledger math. */
  max_value_cents: cents,
})

const perkBenefit = z.strictObject({
  ...benefitBase,
  benefit_type: z.literal(benefitTypeEnum.enumValues[1]),
  /** Perks never appear in a total (hard rule 7), so they must not carry a value. */
  max_value_cents: z.null().optional(),
})

const orderedWindow = <
  T extends { effective_from: PlainDate; effective_to?: PlainDate | null | undefined },
>(
  value: T,
  ctx: z.RefinementCtx,
): void => {
  if (value.effective_to != null && value.effective_to < value.effective_from) {
    ctx.addIssue({
      code: 'custom',
      path: ['effective_to'],
      message: `effective_to ${value.effective_to} precedes effective_from ${value.effective_from}`,
    })
  }
}

export const benefitEntrySchema = z
  .discriminatedUnion('benefit_type', [creditBenefit, perkBenefit])
  .superRefine(orderedWindow)

export const productEntrySchema = z
  .strictObject({
    slug,
    /** Must match an entry in /catalog/issuers.json. */
    issuer: slug,
    name,
    annual_fee_cents: cents,
    effective_from: plainDate,
    effective_to: plainDate.nullish(),
  })
  .superRefine(orderedWindow)

export const catalogFileSchema = z
  .strictObject({
    product: productEntrySchema,
    benefits: z.array(benefitEntrySchema),
  })
  .superRefine((file, ctx) => {
    // SPEC §7: benefit slugs are unique per (product, effective window), which is also
    // the seed upsert key. A duplicate would make seeding order-dependent.
    const seen = new Set<string>()
    file.benefits.forEach((benefit, index) => {
      const key = `${benefit.slug}@${benefit.effective_from}`
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['benefits', index, 'slug'],
          message: `duplicate benefit ${benefit.slug} with effective_from ${benefit.effective_from}`,
        })
      }
      seen.add(key)
    })
  })

export const issuersFileSchema = z
  .array(z.strictObject({ slug, name }))
  .superRefine((issuers, ctx) => {
    const seen = new Set<string>()
    issuers.forEach((issuer, index) => {
      if (seen.has(issuer.slug)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'slug'],
          message: `duplicate issuer slug ${issuer.slug}`,
        })
      }
      seen.add(issuer.slug)
    })
  })

export type CatalogFile = z.output<typeof catalogFileSchema>
export type CatalogProduct = CatalogFile['product']
export type CatalogBenefit = CatalogFile['benefits'][number]
export type CatalogIssuer = z.output<typeof issuersFileSchema>[number]
