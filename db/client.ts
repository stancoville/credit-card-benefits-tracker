/**
 * Neon-backed Drizzle client. Ledger data lives here and only here (SPEC §1).
 *
 * The period engine, ledger math, and catalog validator never import this module — they
 * are pure functions over values the caller has already loaded.
 *
 * The connection is built lazily and memoized. That ordering matters for `pnpm seed`: a
 * malformed catalog should report *that*, not a missing `DATABASE_URL`, even when both are
 * wrong.
 */

import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

export type Database = ReturnType<typeof create>

function create() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.')
  }
  return drizzle(neon(url), { schema })
}

let instance: Database | undefined

/** The shared client. Connects on first use. */
export function getDb(): Database {
  instance ??= create()
  return instance
}

export { schema }
