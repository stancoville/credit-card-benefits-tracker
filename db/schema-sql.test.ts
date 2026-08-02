/**
 * Guards `db/schema.sql` against drifting from `db/schema.ts`.
 *
 * A generated file that nobody regenerates is worse than no file at all: it looks
 * authoritative while quietly describing a schema that no longer exists. This makes the
 * drift a test failure rather than something a person has to remember.
 *
 * It shells out to drizzle-kit, so it is slower than the rest of the suite. That is the
 * price of the guarantee, and it is paid once per run.
 */

import { describe, expect, it } from 'vitest'
import { SCHEMA_SQL_PATH, committedSchemaSql, currentSchemaSql } from '@/scripts/schema-sql'

describe('db/schema.sql', () => {
  it('exists', () => {
    expect(committedSchemaSql(), `${SCHEMA_SQL_PATH} is missing — run \`pnpm db:schema\``).not.toBeNull()
  })

  it('matches db/schema.ts', () => {
    // If this fails, db/schema.ts changed without regenerating the snapshot.
    expect(committedSchemaSql(), 'run `pnpm db:schema` and commit the result').toBe(
      currentSchemaSql(),
    )
  })

  it('covers every table the app queries', () => {
    const sql = committedSchemaSql() ?? ''
    for (const table of [
      'issuers',
      'card_products',
      'benefits',
      'households',
      'users',
      'user_cards',
      'benefit_exclusions',
      'enrollments',
      'redemptions',
    ]) {
      expect(sql, table).toContain(`CREATE TABLE "${table}"`)
    }
  })

  it('has no benefit_periods table, which is the one thing that must never exist', () => {
    // SPEC §3, §5: periods are computed. A snapshot is a good place to notice if that
    // structural decision ever quietly reverses.
    expect(committedSchemaSql() ?? '').not.toContain('CREATE TABLE "benefit_periods"')
  })
})
