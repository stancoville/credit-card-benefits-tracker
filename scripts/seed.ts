/**
 * Idempotent catalog seeding — SPEC §7.
 *
 * `pnpm seed` can run any number of times against the same database and converge on the
 * same state. Upserts key on:
 *
 *   issuers        slug
 *   card_products  slug
 *   benefits       (product_id, slug, effective_from)   <- the §7 key
 *
 * Only the catalog is seeded. Household data (cards, redemptions, enrollments) is never
 * touched, so running this against production is safe by construction (SPEC §1).
 *
 * Validation runs first and fails the whole script: a partially-seeded catalog is worse
 * than an unseeded one.
 *
 * Note on transactions: the Neon HTTP driver has no interactive transactions, so this runs
 * as a sequence of upserts. That is acceptable precisely because it is idempotent — a
 * failed run is fixed by running it again.
 */

import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { benefits, cardProducts, issuers } from '@/db/schema'
import { loadCatalog, toBenefitRow, toIssuerRow, toProductRow } from '@/lib/catalog'
import { todayIn } from '@/lib/date/now'

async function seed(): Promise<void> {
  // Catalog dates are timezone-free, so UTC is the right lens for "is verified_on in the
  // future" — this is not a household-scoped question (SPEC §5.4).
  const asOf = todayIn('UTC')
  // CATALOG_DIR lets the demo environment reseed from a different tree (SPEC §2) without
  // touching the real catalog.
  const dir = process.env.CATALOG_DIR
  const catalog = loadCatalog(dir ? { asOf, dir } : { asOf })

  if (catalog.products.length === 0) {
    console.log('Catalog has no products yet — nothing to seed.')
    console.log('Add files under /catalog/<issuer>/<product>.json; see /catalog/README.md.')
    return
  }

  // Deliberately after validation: a bad catalog should not report a connection problem.
  const db = getDb()
  let issuerCount = 0
  let productCount = 0
  let benefitCount = 0

  for (const issuer of catalog.issuers) {
    await db
      .insert(issuers)
      .values(toIssuerRow(issuer))
      .onConflictDoUpdate({ target: issuers.slug, set: { name: issuer.name } })
    issuerCount += 1
  }

  for (const { path, file } of catalog.products) {
    const issuerRow = await db.query.issuers.findFirst({
      where: eq(issuers.slug, file.product.issuer),
      columns: { id: true },
    })
    if (!issuerRow) {
      throw new Error(`${path}: issuer '${file.product.issuer}' was not seeded`)
    }

    const productRow = toProductRow(file.product, issuerRow.id)
    const [product] = await db
      .insert(cardProducts)
      .values(productRow)
      .onConflictDoUpdate({
        target: cardProducts.slug,
        set: {
          issuerId: productRow.issuerId,
          name: productRow.name,
          annualFee: productRow.annualFee,
          effectiveFrom: productRow.effectiveFrom,
          effectiveTo: productRow.effectiveTo ?? null,
        },
      })
      .returning({ id: cardProducts.id })

    if (!product) throw new Error(`${path}: product upsert returned no row`)
    productCount += 1

    for (const benefit of file.benefits) {
      const row = toBenefitRow(benefit, product.id)
      await db
        .insert(benefits)
        .values(row)
        .onConflictDoUpdate({
          // The §7 upsert key.
          target: [benefits.productId, benefits.slug, benefits.effectiveFrom],
          set: {
            name: row.name,
            benefitType: row.benefitType,
            maxValue: row.maxValue ?? null,
            valueMode: row.valueMode ?? 'fixed',
            estimateBasis: row.estimateBasis ?? null,
            resetType: row.resetType,
            resetInterval: row.resetInterval,
            resetAnchor: row.resetAnchor,
            requiresEnrollment: row.requiresEnrollment,
            appliesTo: row.appliesTo,
            merchantScope: row.merchantScope ?? null,
            notes: row.notes ?? null,
            sourceUrl: row.sourceUrl,
            verifiedOn: row.verifiedOn,
            effectiveTo: row.effectiveTo ?? null,
          },
        })
      benefitCount += 1
    }
  }

  console.log(
    `Seeded ${issuerCount} issuer(s), ${productCount} product(s), ${benefitCount} benefit(s).`,
  )
}

seed()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
