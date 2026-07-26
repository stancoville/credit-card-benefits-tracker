/**
 * Drizzle client. Ledger data lives here and only here (SPEC §1).
 *
 * The period engine, ledger math, catalog validator, and dashboard model never import this
 * module — they are pure functions over values the caller has already loaded.
 *
 * Two drivers, chosen from the connection string:
 *
 *   - **Neon HTTP** for `*.neon.tech`, which is what production and preview run on
 *     (SPEC §2) and what works on Vercel's serverless runtime.
 *   - **node-postgres** for anything else, so a self-hoster can point this at their own
 *     Postgres and `pnpm dev` locally (SPEC §8 asks for self-host steps that actually work).
 *
 * The connection is built lazily and memoized. That ordering matters for `pnpm seed`: a
 * malformed catalog should report *that*, not a missing `DATABASE_URL`, even when both are
 * wrong.
 */

import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeon, type NeonHttpDatabase } from 'drizzle-orm/neon-http'
import { drizzle as drizzleNode } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

/**
 * Typed as the Neon HTTP database deliberately: it is the *more restrictive* of the two
 * drivers (no interactive transactions), so the type never promises a capability that
 * production lacks. node-postgres satisfies everything in this surface.
 */
export type Database = NeonHttpDatabase<typeof schema>

function connectionString(): string {
  const url = process.env.DATABASE_URL
  if (!url || url.trim() === '') {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.')
  }
  return url
}

/** Neon's HTTP driver speaks websockets, so it cannot reach a plain local Postgres. */
export function isNeonUrl(url: string): boolean {
  return /neon\.tech|neon\.build/.test(url)
}

function create(): Database {
  const url = connectionString()
  if (isNeonUrl(url)) return drizzleNeon(neon(url), { schema })
  // Same query-builder surface, different session type — hence the one narrow cast.
  return drizzleNode(new Pool({ connectionString: url }), { schema }) as unknown as Database
}

let instance: Database | undefined

/** The shared client. Connects on first use. */
export function getDb(): Database {
  instance ??= create()
  return instance
}

export { schema }
