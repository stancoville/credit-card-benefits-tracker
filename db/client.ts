/**
 * Neon-backed Drizzle client. Ledger data lives here and only here (SPEC §1).
 *
 * The period engine and ledger math never import this module — they are pure functions
 * over values the caller has already loaded.
 */

import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

function connectionString(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.')
  }
  return url
}

export const db = drizzle(neon(connectionString()), { schema })

export type Database = typeof db
export { schema }
