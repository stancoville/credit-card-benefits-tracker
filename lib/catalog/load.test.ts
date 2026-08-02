/**
 * Catalog loading tests — cross-file rules the per-file schema cannot see, plus a
 * validation pass over the real /catalog directory so CI fails on bad data (SPEC §7).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parsePlainDate } from '@/lib/date/plain-date'
import { CatalogValidationError, loadCatalog } from './load'

const created: string[] = []

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop()!, { recursive: true, force: true })
  }
})

interface Fixture {
  issuers?: unknown
  files?: Record<string, unknown>
}

function makeCatalog(fixture: Fixture): string {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-'))
  created.push(dir)
  writeFileSync(
    join(dir, 'issuers.json'),
    JSON.stringify(fixture.issuers ?? [{ slug: 'example-issuer', name: 'Example Issuer' }]),
  )
  for (const [relative, contents] of Object.entries(fixture.files ?? {})) {
    const parts = relative.split('/')
    mkdirSync(join(dir, ...parts.slice(0, -1)), { recursive: true })
    writeFileSync(join(dir, ...parts), JSON.stringify(contents))
  }
  return dir
}

function product(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product: {
      slug: 'example-premium-card',
      issuer: 'example-issuer',
      name: 'Example Premium Card',
      annual_fee_cents: 69500,
      effective_from: '2025-01-01',
      ...overrides,
    },
    benefits: [
      {
        slug: 'example-monthly-credit',
        name: 'Example monthly credit',
        benefit_type: 'credit',
        max_value_cents: 1500,
        reset_type: 'monthly',
        reset_anchor: 'calendar',
        requires_enrollment: false,
        applies_to: 'primary',
        source_url: 'https://example.com/terms',
        verified_on: '2026-07-01',
        effective_from: '2025-01-01',
      },
    ],
  }
}

function problemsFrom(fn: () => unknown): string[] {
  try {
    fn()
  } catch (error) {
    if (error instanceof CatalogValidationError) return [...error.problems]
    throw error
  }
  throw new Error('expected CatalogValidationError')
}

describe('loading a valid catalog', () => {
  it('returns issuers and products', () => {
    const dir = makeCatalog({
      files: { 'example-issuer/example-premium-card.json': product() },
    })
    const catalog = loadCatalog({ dir })
    expect(catalog.issuers).toEqual([{ slug: 'example-issuer', name: 'Example Issuer' }])
    expect(catalog.products).toHaveLength(1)
    expect(catalog.products[0]!.path).toBe(join('example-issuer', 'example-premium-card.json'))
    expect(catalog.products[0]!.file.product.annual_fee_cents).toBe(69500)
  })

  it('handles an empty catalog, so the repo works before any product is added', () => {
    const dir = makeCatalog({ issuers: [] })
    const catalog = loadCatalog({ dir })
    expect(catalog.issuers).toEqual([])
    expect(catalog.products).toEqual([])
  })
})

describe('cross-file validation', () => {
  it('rejects a product whose issuer is not in issuers.json', () => {
    const dir = makeCatalog({
      issuers: [{ slug: 'other-issuer', name: 'Other Issuer' }],
      files: { 'example-issuer/example-premium-card.json': product() },
    })
    expect(problemsFrom(() => loadCatalog({ dir })).join('\n')).toMatch(/not in issuers\.json/)
  })

  it('rejects a product filed under the wrong issuer directory', () => {
    const dir = makeCatalog({
      issuers: [
        { slug: 'example-issuer', name: 'Example Issuer' },
        { slug: 'other-issuer', name: 'Other Issuer' },
      ],
      files: { 'other-issuer/example-premium-card.json': product() },
    })
    expect(problemsFrom(() => loadCatalog({ dir })).join('\n')).toMatch(
      /does not match its directory/,
    )
  })

  it('rejects a filename that disagrees with product.slug', () => {
    const dir = makeCatalog({
      files: { 'example-issuer/wrong-name.json': product() },
    })
    expect(problemsFrom(() => loadCatalog({ dir })).join('\n')).toMatch(
      /filename should be 'example-premium-card\.json'/,
    )
  })

  it('rejects the same product slug defined twice', () => {
    const dir = makeCatalog({
      files: {
        'example-issuer/example-premium-card.json': product(),
        'example-issuer/duplicate.json': product(),
      },
    })
    expect(problemsFrom(() => loadCatalog({ dir })).join('\n')).toMatch(/already defined in/)
  })

  it('rejects a verified_on in the future, because it was not verified', () => {
    const dir = makeCatalog({
      files: { 'example-issuer/example-premium-card.json': product() },
    })
    const problems = problemsFrom(() =>
      loadCatalog({ dir, asOf: parsePlainDate('2026-06-30') }),
    )
    expect(problems.join('\n')).toMatch(/verified_on 2026-07-01, which is after today/)
  })

  it('accepts a verified_on of today', () => {
    const dir = makeCatalog({
      files: { 'example-issuer/example-premium-card.json': product() },
    })
    expect(loadCatalog({ dir, asOf: parsePlainDate('2026-07-01') }).products).toHaveLength(1)
  })

  it('reports every problem at once rather than only the first', () => {
    const bad = product({ slug: 'mismatched-slug' })
    const dir = makeCatalog({
      issuers: [],
      files: { 'example-issuer/example-premium-card.json': bad },
    })
    expect(problemsFrom(() => loadCatalog({ dir })).length).toBeGreaterThan(1)
  })

  it('reports malformed JSON with the file path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'catalog-'))
    created.push(dir)
    writeFileSync(join(dir, 'issuers.json'), '{ not json')
    expect(problemsFrom(() => loadCatalog({ dir })).join('\n')).toMatch(/not valid JSON/)
  })
})

describe('templates', () => {
  it('skips _-prefixed directories when seeding', () => {
    const dir = makeCatalog({
      issuers: [],
      files: { '_template/example-premium-card.json': product() },
    })
    expect(loadCatalog({ dir }).products).toEqual([])
  })

  it('includes them when asked, so the test suite still validates the template', () => {
    const dir = makeCatalog({
      issuers: [],
      files: { '_template/example-premium-card.json': product() },
    })
    expect(loadCatalog({ dir, includeTemplates: true }).products).toHaveLength(1)
  })
})

describe('the real /catalog directory', () => {
  it('passes validation, templates included', () => {
    // Guards against a bad contribution landing: this is the check CI relies on.
    //
    // Deliberately no `asOf`: pinning one would make this test fail every time a
    // contributor re-verifies an entry with a newer date. The future-verified_on rule is
    // covered against a fixture above, and `pnpm seed` enforces it against the real clock
    // at deploy time.
    expect(() => loadCatalog({ includeTemplates: true })).not.toThrow()
  })

  it('contains no seedable product with an unverified amount', () => {
    const catalog = loadCatalog({ includeTemplates: true })
    for (const { path, file } of catalog.products) {
      for (const benefit of file.benefits) {
        expect(benefit.source_url, `${path} ${benefit.slug}`).toMatch(/^https?:\/\//)
        expect(benefit.verified_on, `${path} ${benefit.slug}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
    }
  })
})

describe('the shipped issuer registry', () => {
  it('gives every issuer guidance on finding the account open date', () => {
    // opened_on anchors every period key (SPEC §5.2) and almost nobody knows it offhand,
    // so an issuer without a hint is a gap a user will feel.
    const catalog = loadCatalog({ includeTemplates: false })
    for (const issuer of catalog.issuers) {
      expect(issuer.account_opened_hint, issuer.slug).toBeTruthy()
    }
  })
})
