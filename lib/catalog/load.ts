/**
 * Reads and validates the catalog on disk (SPEC §7).
 *
 * Layout:
 *   /catalog/issuers.json                        slug → display name
 *   /catalog/<issuer-slug>/<product-slug>.json   one file per card product
 *
 * Entries whose name starts with `_` are templates: validated by the test suite, never
 * seeded. That is how `_template/` documents the shape without putting a fictional product
 * into a production database.
 *
 * `/catalog/issuers.json` is an addition to §7, which gives a product's issuer as a slug
 * but never says where `issuers.name` (§3.1) comes from. One file mapping slug to name is
 * the smallest thing that closes that gap.
 *
 * Errors are aggregated rather than thrown one at a time: a contributor fixing a catalog
 * PR should see every problem in one run.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { z } from 'zod'
import type { PlainDate } from '@/lib/date/plain-date'
import {
  catalogFileSchema,
  issuersFileSchema,
  type CatalogFile,
  type CatalogIssuer,
} from './schema'

export const DEFAULT_CATALOG_DIR = 'catalog'

export interface CatalogEntry {
  /** Path relative to the catalog directory, for error messages. */
  readonly path: string
  readonly file: CatalogFile
}

export interface LoadedCatalog {
  readonly issuers: readonly CatalogIssuer[]
  readonly products: readonly CatalogEntry[]
}

export interface LoadCatalogOptions {
  /** Defaults to `catalog`, relative to the working directory. */
  readonly dir?: string
  /** When provided, a `verified_on` after this date is an error. */
  readonly asOf?: PlainDate
  /** Include `_`-prefixed template entries. Tests do; seeding does not. */
  readonly includeTemplates?: boolean
}

export class CatalogValidationError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(
      `Catalog validation failed with ${problems.length} problem${
        problems.length === 1 ? '' : 's'
      }:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    )
    this.name = 'CatalogValidationError'
    this.problems = problems
  }
}

function formatIssues(where: string, error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
    return `${where}: ${path} — ${issue.message}`
  })
}

function isHidden(entryName: string): boolean {
  return entryName.startsWith('.') || entryName.startsWith('_')
}

function readJson(path: string): unknown {
  const raw = readFileSync(path, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (cause) {
    throw new CatalogValidationError([
      `${path}: not valid JSON — ${cause instanceof Error ? cause.message : String(cause)}`,
    ])
  }
}

/**
 * Load, parse, and validate the whole catalog.
 *
 * @throws {CatalogValidationError} with every problem found, not just the first.
 */
export function loadCatalog(options: LoadCatalogOptions = {}): LoadedCatalog {
  const dir = options.dir ?? DEFAULT_CATALOG_DIR
  const includeTemplates = options.includeTemplates ?? false
  const problems: string[] = []

  // --- issuers.json -------------------------------------------------------
  const issuersPath = join(dir, 'issuers.json')
  const issuersResult = issuersFileSchema.safeParse(readJson(issuersPath))
  if (!issuersResult.success) {
    throw new CatalogValidationError(formatIssues('issuers.json', issuersResult.error))
  }
  const issuers = issuersResult.data
  const issuerSlugs = new Set(issuers.map((issuer) => issuer.slug))

  // --- product files ------------------------------------------------------
  const products: CatalogEntry[] = []
  const seenProductSlugs = new Map<string, string>()

  const issuerDirs = readdirSync(dir).filter((entry) => {
    if (!includeTemplates && isHidden(entry)) return false
    if (entry === 'issuers.json') return false
    return statSync(join(dir, entry)).isDirectory()
  })

  for (const issuerDir of issuerDirs.sort()) {
    const files = readdirSync(join(dir, issuerDir))
      .filter((entry) => entry.endsWith('.json'))
      .filter((entry) => includeTemplates || !isHidden(entry))
      .sort()

    for (const fileName of files) {
      const relative = join(issuerDir, fileName)
      const parsed = catalogFileSchema.safeParse(readJson(join(dir, relative)))

      if (!parsed.success) {
        problems.push(...formatIssues(relative, parsed.error))
        continue
      }

      const file = parsed.data
      const isTemplate = isHidden(issuerDir) || isHidden(fileName)

      // Cross-file checks the per-file schema cannot see.
      if (!isTemplate && !issuerSlugs.has(file.product.issuer)) {
        problems.push(
          `${relative}: product.issuer '${file.product.issuer}' is not in issuers.json`,
        )
      }
      if (!isTemplate && file.product.issuer !== issuerDir) {
        problems.push(
          `${relative}: product.issuer '${file.product.issuer}' does not match its directory '${issuerDir}'`,
        )
      }
      if (fileName !== `${file.product.slug}.json` && !isTemplate) {
        problems.push(
          `${relative}: filename should be '${file.product.slug}.json' to match product.slug`,
        )
      }

      const duplicate = seenProductSlugs.get(file.product.slug)
      if (duplicate !== undefined) {
        problems.push(
          `${relative}: product slug '${file.product.slug}' already defined in ${duplicate}`,
        )
      } else {
        seenProductSlugs.set(file.product.slug, relative)
      }

      // Hard rule 5: a benefit verified in the future was not verified.
      if (options.asOf !== undefined) {
        for (const benefit of file.benefits) {
          if (benefit.verified_on > options.asOf) {
            problems.push(
              `${relative}: benefit '${benefit.slug}' has verified_on ${benefit.verified_on}, which is after today (${options.asOf})`,
            )
          }
        }
      }

      products.push({ path: relative, file })
    }
  }

  if (problems.length > 0) throw new CatalogValidationError(problems)

  return { issuers, products }
}
