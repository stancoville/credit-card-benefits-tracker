/**
 * Catalog validator tests — SPEC §7 and CLAUDE.md hard rules 1, 5, 6, 7.
 *
 * These assert the validator *rejects* bad data, which is the point: the catalog is a
 * public contribution surface, and a wrong amount is worse than a missing one.
 */

import { describe, expect, it } from 'vitest'
import { parsePlainDate } from '@/lib/date/plain-date'
import { catalogFileSchema, issuersFileSchema } from './schema'

type Json = Record<string, unknown>

function creditBenefit(overrides: Json = {}): Json {
  return {
    slug: 'example-monthly-credit',
    name: 'Example monthly credit',
    benefit_type: 'credit',
    max_value_cents: 1500,
    reset_type: 'monthly',
    reset_anchor: 'calendar',
    reset_interval: 1,
    requires_enrollment: false,
    applies_to: 'primary',
    source_url: 'https://example.com/terms',
    verified_on: '2026-07-01',
    effective_from: '2025-01-01',
    ...overrides,
  }
}

function catalogFile(overrides: { product?: Json; benefits?: Json[] } = {}): Json {
  return {
    product: {
      slug: 'example-premium-card',
      issuer: 'example-issuer',
      name: 'Example Premium Card',
      annual_fee_cents: 69500,
      effective_from: '2025-01-01',
      ...overrides.product,
    },
    benefits: overrides.benefits ?? [creditBenefit()],
  }
}

/** The first error message, for readable assertions. */
function firstError(input: unknown): string {
  const result = catalogFileSchema.safeParse(input)
  expect(result.success).toBe(false)
  return result.error!.issues[0]!.message
}

/** Dotted path of the first error, e.g. 'benefits.0.source_url'. */
function firstErrorPath(input: unknown): string {
  const result = catalogFileSchema.safeParse(input)
  expect(result.success).toBe(false)
  return result.error!.issues[0]!.path.join('.')
}

describe('a well-formed file', () => {
  it('parses', () => {
    const result = catalogFileSchema.safeParse(catalogFile())
    expect(result.success).toBe(true)
  })

  it('applies defaults for reset_interval and requires_enrollment', () => {
    const benefit = creditBenefit()
    delete benefit.reset_interval
    delete benefit.requires_enrollment
    const result = catalogFileSchema.safeParse(catalogFile({ benefits: [benefit] }))
    expect(result.success).toBe(true)
    expect(result.data!.benefits[0]!.reset_interval).toBe(1)
    expect(result.data!.benefits[0]!.requires_enrollment).toBe(false)
  })

  it('returns dates as PlainDate values the engine can consume directly', () => {
    const result = catalogFileSchema.parse(catalogFile())
    expect(result.product.effective_from).toBe(parsePlainDate('2025-01-01'))
    expect(result.benefits[0]!.verified_on).toBe(parsePlainDate('2026-07-01'))
    expect(result.benefits[0]!.effective_to ?? null).toBeNull()
  })

  it('accepts a perk with no value', () => {
    const perk = creditBenefit({ slug: 'example-perk', benefit_type: 'perk' })
    delete perk.max_value_cents
    expect(catalogFileSchema.safeParse(catalogFile({ benefits: [perk] })).success).toBe(true)
  })

  it('accepts an empty benefit list, so a product can be added before its benefits', () => {
    expect(catalogFileSchema.safeParse(catalogFile({ benefits: [] })).success).toBe(true)
  })
})

describe('hard rule 5 — every amount needs a source', () => {
  it('rejects a benefit with no source_url', () => {
    const benefit = creditBenefit()
    delete benefit.source_url
    expect(firstErrorPath(catalogFile({ benefits: [benefit] }))).toBe('benefits.0.source_url')
  })

  it('rejects a benefit with no verified_on', () => {
    const benefit = creditBenefit()
    delete benefit.verified_on
    expect(firstErrorPath(catalogFile({ benefits: [benefit] }))).toBe('benefits.0.verified_on')
  })

  it('rejects a source_url that is not a URL', () => {
    const input = catalogFile({ benefits: [creditBenefit({ source_url: 'issuer terms' })] })
    expect(firstError(input)).toMatch(/issuer terms this amount came from/)
  })

  it('rejects a malformed verified_on date', () => {
    for (const bad of ['2026-13-01', '2026-02-30', 'July 2026', '2026-7-1']) {
      const input = catalogFile({ benefits: [creditBenefit({ verified_on: bad })] })
      expect(firstError(input)).toMatch(/real calendar date/)
    }
  })
})

describe('hard rule 1 — money is integer cents', () => {
  it('rejects a float in a cents field', () => {
    expect(firstError(catalogFile({ benefits: [creditBenefit({ max_value_cents: 15.5 })] }))).toMatch(
      /integer cents/,
    )
    expect(firstError(catalogFile({ product: { annual_fee_cents: 695.0000001 } }))).toMatch(
      /integer cents/,
    )
  })

  it('rejects a negative amount', () => {
    const input = catalogFile({ benefits: [creditBenefit({ max_value_cents: -1500 })] })
    expect(catalogFileSchema.safeParse(input).success).toBe(false)
  })

  it('accepts a zero amount, since a $0 credit is a real catalog state', () => {
    const input = catalogFile({ benefits: [creditBenefit({ max_value_cents: 0 })] })
    expect(catalogFileSchema.safeParse(input).success).toBe(true)
  })
})

describe('hard rule 7 — only credits enter ledger math', () => {
  it('rejects a credit with no max_value_cents', () => {
    const benefit = creditBenefit()
    delete benefit.max_value_cents
    expect(catalogFileSchema.safeParse(catalogFile({ benefits: [benefit] })).success).toBe(false)
  })

  it('rejects a perk that carries a value', () => {
    const perk = creditBenefit({ benefit_type: 'perk', max_value_cents: 1500 })
    expect(catalogFileSchema.safeParse(catalogFile({ benefits: [perk] })).success).toBe(false)
  })

  it('accepts a perk with an explicit null value', () => {
    const perk = creditBenefit({ benefit_type: 'perk', max_value_cents: null })
    expect(catalogFileSchema.safeParse(catalogFile({ benefits: [perk] })).success).toBe(true)
  })
})

describe('hard rule 6 — no logos or card art', () => {
  it('rejects an unknown field on a product, so image fields cannot land', () => {
    const input = catalogFile({ product: { logo_url: 'https://example.com/logo.svg' } })
    expect(catalogFileSchema.safeParse(input).success).toBe(false)
  })

  it('rejects an unknown field on a benefit, which also catches typos', () => {
    const input = catalogFile({ benefits: [creditBenefit({ max_value_cent: 1500 })] })
    expect(catalogFileSchema.safeParse(input).success).toBe(false)
  })

  it('rejects an unknown top-level key', () => {
    expect(catalogFileSchema.safeParse({ ...catalogFile(), card_art: 'x' }).success).toBe(false)
  })
})

describe('enums stay in sync with the database', () => {
  it('rejects a reset_type the schema does not define', () => {
    const input = catalogFile({ benefits: [creditBenefit({ reset_type: 'biweekly' })] })
    expect(catalogFileSchema.safeParse(input).success).toBe(false)
  })

  it('accepts every reset_type in SPEC §5.2', () => {
    for (const resetType of ['monthly', 'quarterly', 'semiannual', 'annual', 'rolling', 'one_time']) {
      const input = catalogFile({ benefits: [creditBenefit({ reset_type: resetType })] })
      expect(catalogFileSchema.safeParse(input).success).toBe(true)
    }
  })

  it('accepts both reset anchors and every applies_to value', () => {
    for (const anchor of ['calendar', 'card_open']) {
      expect(
        catalogFileSchema.safeParse(catalogFile({ benefits: [creditBenefit({ reset_anchor: anchor })] }))
          .success,
      ).toBe(true)
    }
    for (const appliesTo of ['primary', 'authorized_user', 'both']) {
      expect(
        catalogFileSchema.safeParse(catalogFile({ benefits: [creditBenefit({ applies_to: appliesTo })] }))
          .success,
      ).toBe(true)
    }
  })

  it('rejects a reset_interval below 1 or non-integer', () => {
    for (const bad of [0, -1, 1.5]) {
      const input = catalogFile({ benefits: [creditBenefit({ reset_interval: bad })] })
      expect(catalogFileSchema.safeParse(input).success).toBe(false)
    }
  })
})

describe('slugs and windows', () => {
  it('requires kebab-case slugs', () => {
    for (const bad of ['Example Premium', 'example_premium', 'ExamplePremium', 'example--x']) {
      expect(catalogFileSchema.safeParse(catalogFile({ product: { slug: bad } })).success).toBe(false)
    }
  })

  it('rejects an inverted effective window on a benefit', () => {
    const input = catalogFile({
      benefits: [creditBenefit({ effective_from: '2026-06-01', effective_to: '2026-01-01' })],
    })
    expect(firstError(input)).toMatch(/precedes effective_from/)
  })

  it('rejects an inverted effective window on a product', () => {
    const input = catalogFile({
      product: { effective_from: '2026-06-01', effective_to: '2026-01-01' },
    })
    expect(firstError(input)).toMatch(/precedes effective_from/)
  })

  it('accepts a benefit superseded by a later effective window', () => {
    const input = catalogFile({
      benefits: [
        creditBenefit({ effective_from: '2025-01-01', effective_to: '2025-12-31' }),
        creditBenefit({ effective_from: '2026-01-01' }),
      ],
    })
    expect(catalogFileSchema.safeParse(input).success).toBe(true)
  })

  it('rejects two benefits sharing a slug and effective_from, the §7 upsert key', () => {
    const input = catalogFile({ benefits: [creditBenefit(), creditBenefit()] })
    expect(firstError(input)).toMatch(/duplicate benefit/)
  })
})

describe('issuers.json', () => {
  it('parses a well-formed registry', () => {
    const result = issuersFileSchema.safeParse([{ slug: 'example-issuer', name: 'Example Issuer' }])
    expect(result.success).toBe(true)
  })

  it('accepts an empty registry', () => {
    expect(issuersFileSchema.safeParse([]).success).toBe(true)
  })

  it('rejects duplicate issuer slugs', () => {
    const result = issuersFileSchema.safeParse([
      { slug: 'example-issuer', name: 'Example Issuer' },
      { slug: 'example-issuer', name: 'Example Issuer Again' },
    ])
    expect(result.success).toBe(false)
    expect(result.error!.issues[0]!.message).toMatch(/duplicate issuer slug/)
  })

  it('rejects an unknown field', () => {
    const result = issuersFileSchema.safeParse([
      { slug: 'example-issuer', name: 'Example Issuer', logo: 'x' },
    ])
    expect(result.success).toBe(false)
  })
})
