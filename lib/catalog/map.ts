/**
 * Pure mapping from catalog JSON (SPEC §7) to database rows (SPEC §3.1).
 *
 * Split out of `/scripts/seed.ts` so the interesting part — where a `_cents` field lands,
 * what an omitted optional becomes — is testable without a database.
 *
 * The JSON keys carry a `_cents` suffix and the columns do not. That asymmetry is
 * deliberate: the suffix is a warning to whoever hand-edits the catalog, while §3.1 fixes
 * the column names. This module is the only place the two vocabularies meet.
 */

import type { NewBenefit, NewCardProduct, NewIssuer } from '@/db/schema'
import type { CatalogBenefit, CatalogIssuer, CatalogProduct } from './schema'

export function toIssuerRow(issuer: CatalogIssuer): NewIssuer {
  return { slug: issuer.slug, name: issuer.name }
}

export function toProductRow(product: CatalogProduct, issuerId: string): NewCardProduct {
  return {
    issuerId,
    slug: product.slug,
    name: product.name,
    annualFee: product.annual_fee_cents,
    effectiveFrom: product.effective_from,
    effectiveTo: product.effective_to ?? null,
  }
}

export function toBenefitRow(benefit: CatalogBenefit, productId: string): NewBenefit {
  return {
    productId,
    slug: benefit.slug,
    name: benefit.name,
    benefitType: benefit.benefit_type,
    // Perks carry no value and never enter a total (hard rule 7).
    maxValue: benefit.benefit_type === 'credit' ? benefit.max_value_cents : null,
    valueMode: benefit.benefit_type === 'credit' ? benefit.value_mode : 'fixed',
    estimateBasis:
      benefit.benefit_type === 'credit' ? (benefit.estimate_basis ?? null) : null,
    resetType: benefit.reset_type,
    resetInterval: benefit.reset_interval,
    resetAnchor: benefit.reset_anchor,
    requiresEnrollment: benefit.requires_enrollment,
    appliesTo: benefit.applies_to,
    merchantScope: benefit.merchant_scope ?? null,
    notes: benefit.notes ?? null,
    sourceUrl: benefit.source_url,
    verifiedOn: benefit.verified_on,
    effectiveFrom: benefit.effective_from,
    effectiveTo: benefit.effective_to ?? null,
  }
}
