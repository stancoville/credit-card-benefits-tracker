/**
 * Keeps `db/schema.sql` in step with `db/schema.ts`.
 *
 * `db/schema.ts` is the source of truth and `db/migrations` is how an existing database
 * catches up to it. Neither of those answers the question a self-hoster actually has:
 * *what is the schema, right now, in one file I can read or apply?* Replaying a migration
 * history to find out is indirection, and reading TypeScript is not an option for everyone
 * looking at a public repo.
 *
 * So `db/schema.sql` is a generated, always-current snapshot of the full DDL.
 *
 *   pnpm db:schema         # regenerate it
 *   pnpm db:schema:check   # fail if it has drifted (this runs in the test suite)
 *
 * Never edit `db/schema.sql` by hand — edit `db/schema.ts` and regenerate.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

export const SCHEMA_SQL_PATH = 'db/schema.sql'

const HEADER = `-- Generated from db/schema.ts by \`pnpm db:schema\`. Do not edit by hand.
--
-- The full current schema in one file. Apply it to an empty database with:
--   psql "$DATABASE_URL" -f db/schema.sql
--
-- An existing database should use \`pnpm db:migrate\` instead, which replays
-- db/migrations and records what it applied.

`

/** The DDL drizzle-kit derives from db/schema.ts, normalised so comparisons are stable. */
export function currentSchemaSql(): string {
  const raw = execFileSync('npx', ['drizzle-kit', 'export', '--sql'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  return HEADER + raw.replace(/\r\n/g, '\n').trimEnd() + '\n'
}

export function committedSchemaSql(): string | null {
  return existsSync(SCHEMA_SQL_PATH) ? readFileSync(SCHEMA_SQL_PATH, 'utf8') : null
}

function main(): void {
  const check = process.argv.includes('--check')
  const current = currentSchemaSql()

  if (!check) {
    writeFileSync(SCHEMA_SQL_PATH, current)
    console.log(`Wrote ${SCHEMA_SQL_PATH} (${current.split('\n').length} lines).`)
    return
  }

  const committed = committedSchemaSql()
  if (committed === current) {
    console.log(`${SCHEMA_SQL_PATH} is up to date.`)
    return
  }

  console.error(
    committed === null
      ? `${SCHEMA_SQL_PATH} is missing.`
      : `${SCHEMA_SQL_PATH} is out of date with db/schema.ts.`,
  )
  console.error('Run `pnpm db:schema` and commit the result.')
  process.exitCode = 1
}

// Only run as a script, so the test suite can import the helpers above.
if (process.argv[1]?.endsWith('schema-sql.ts')) main()
