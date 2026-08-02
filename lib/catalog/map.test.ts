/**
 * Mapping tests — catalog JSON to database rows.
 *
 * The failure this guards against is a silent unit or nullability slip between the `_cents`
 * vocabulary of the catalog and the column names in SPEC §3.1.
 */

import { describe, expect, it } from 'vitest'
import { catalogFileSchema } from './schema'
import { toBenefitRow, toIssuerRow, toProductRow } from './map'

const PRODUCT_ID = '00000000-0000-0000-0000-00000000beef'
const ISSUER_ID = '00000000-0000-0000-0000-0000000000a1'

function parse(input: unknown) {
  return catalogFileSchema.parse(input)
}

const base = {
  product: {
    slug: 'example-premium-card',
    issuer: 'example-issuer',
    name: 'Example Premium Card',
    annual_fee_cents: 69500,
    effective_from: '2025-01-01',
  },
  benefits: [
    {
      slug: 'example-monthly-credit',
      name: 'Example monthly credit',
      benefit_type: 'credit',
      max_value_cents: 1500,
      reset_type: 'monthly',
      reset_anchor: 'calendar',
      reset_interval: 1,
      requires_enrollment: false,
      applies_to: 'primary',
      merchant_scope: 'Example merchant',
      source_url: 'https://example.com/terms',
      verified_on: '2026-07-01',
      effective_from: '2025-01-01',
    },
  ],
}

describe('toIssuerRow', () => {
  it('maps slug and name', () => {
    expect(toIssuerRow({ slug: 'example-issuer', name: 'Example Issuer' })).toEqual({
      slug: 'example-issuer',
      name: 'Example Issuer',
    })
  })
})

describe('toProductRow', () => {
  it('moves annual_fee_cents to annual_fee without changing the number', () => {
    const row = toProductRow(parse(base).product, ISSUER_ID)
    expect(row).toEqual({
      issuerId: ISSUER_ID,
      slug: 'example-premium-card',
      name: 'Example Premium Card',
      annualFee: 69500,
      effectiveFrom: '2025-01-01',
      effectiveTo: null,
    })
  })

  it('turns an omitted effective_to into null, not undefined', () => {
    const row = toProductRow(parse(base).product, ISSUER_ID)
    expect(row.effectiveTo).toBeNull()
  })

  it('preserves an explicit effective_to', () => {
    const file = parse({
      ...base,
      product: { ...base.product, effective_to: '2027-12-31' },
    })
    expect(toProductRow(file.product, ISSUER_ID).effectiveTo).toBe('2027-12-31')
  })
})

describe('toBenefitRow', () => {
  it('maps a credit, moving max_value_cents to max_value', () => {
    const row = toBenefitRow(parse(base).benefits[0]!, PRODUCT_ID)
    expect(row).toEqual({
      productId: PRODUCT_ID,
      slug: 'example-monthly-credit',
      name: 'Example monthly credit',
      benefitType: 'credit',
      maxValue: 1500,
      valueMode: 'fixed',
      estimateBasis: null,
      unlockSpend: null,
      resetType: 'monthly',
      resetInterval: 1,
      resetAnchor: 'calendar',
      requiresEnrollment: false,
      appliesTo: 'primary',
      merchantScope: 'Example merchant',
      notes: null,
      sourceUrl: 'https://example.com/terms',
      verifiedOn: '2026-07-01',
      effectiveFrom: '2025-01-01',
      effectiveTo: null,
    })
  })

  it('gives a perk a null max_value, so it can never enter a total', () => {
    const perk = { ...base.benefits[0]!, benefit_type: 'perk' as const }
    delete (perk as Record<string, unknown>).max_value_cents
    const file = parse({ ...base, benefits: [perk] })
    expect(toBenefitRow(file.benefits[0]!, PRODUCT_ID).maxValue).toBeNull()
  })

  it('carries the defaulted reset_interval through to the row', () => {
    const benefit = { ...base.benefits[0]! }
    delete (benefit as Record<string, unknown>).reset_interval
    const file = parse({ ...base, benefits: [benefit] })
    expect(toBenefitRow(file.benefits[0]!, PRODUCT_ID).resetInterval).toBe(1)
  })

  it('turns omitted optionals into null rather than undefined', () => {
    const benefit = { ...base.benefits[0]! }
    delete (benefit as Record<string, unknown>).merchant_scope
    const file = parse({ ...base, benefits: [benefit] })
    const row = toBenefitRow(file.benefits[0]!, PRODUCT_ID)
    expect(row.merchantScope).toBeNull()
    expect(row.notes).toBeNull()
    expect(row.effectiveTo).toBeNull()
  })

  it('produces a row the period engine can consume as a PeriodBenefit', () => {
    const row = toBenefitRow(parse(base).benefits[0]!, PRODUCT_ID)
    // Structural check: these are exactly the fields /lib/periods reads.
    expect(row.resetType).toBe('monthly')
    expect(row.resetInterval).toBe(1)
    expect(row.resetAnchor).toBe('calendar')
    expect(row.effectiveFrom).toBe('2025-01-01')
    expect(row.effectiveTo).toBeNull()
  })
})

describe('§4.6 estimated benefits map their basis through', () => {
  const certificate = {
    ...base.benefits[0]!,
    slug: 'free-night-award',
    name: 'Free night award',
    max_value_cents: 20000,
    value_mode: 'estimated' as const,
    estimate_basis: 'Award capped at 35k points, valued at 0.6c/pt',
  }

  it('carries value_mode and estimate_basis onto the row', () => {
    const file = parse({ ...base, benefits: [certificate] })
    const row = toBenefitRow(file.benefits[0]!, PRODUCT_ID)
    expect(row.valueMode).toBe('estimated')
    expect(row.estimateBasis).toBe('Award capped at 35k points, valued at 0.6c/pt')
    expect(row.maxValue).toBe(20000)
  })

  it('defaults a benefit with no value_mode to fixed with no basis', () => {
    const row = toBenefitRow(parse(base).benefits[0]!, PRODUCT_ID)
    expect(row.valueMode).toBe('fixed')
    expect(row.estimateBasis).toBeNull()
  })

  it('gives a perk fixed mode and no basis, since perks carry no value', () => {
    const perk = { ...base.benefits[0]!, benefit_type: 'perk' as const }
    delete (perk as Record<string, unknown>).max_value_cents
    const file = parse({ ...base, benefits: [perk] })
    const row = toBenefitRow(file.benefits[0]!, PRODUCT_ID)
    expect(row.valueMode).toBe('fixed')
    expect(row.estimateBasis).toBeNull()
  })
})

describe('§4.7 spend-gated benefits carry their threshold through', () => {
  it('maps unlock_spend_cents onto the row', () => {
    const gated = {
      ...base.benefits[0]!,
      slug: 'spend-gated-award',
      name: 'Award after spend',
      unlock_spend_cents: 1500000,
    }
    const file = parse({ ...base, benefits: [gated] })
    expect(toBenefitRow(file.benefits[0]!, PRODUCT_ID).unlockSpend).toBe(1500000)
  })

  it('leaves an unconditional benefit with a null threshold', () => {
    expect(toBenefitRow(parse(base).benefits[0]!, PRODUCT_ID).unlockSpend).toBeNull()
  })
})
