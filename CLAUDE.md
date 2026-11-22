# CLAUDE.md

Read `SPEC.md` before starting any task. It is the source of truth. If a request
conflicts with the spec, say so rather than silently picking one.

## Stack

Next.js (App Router) · TypeScript strict · Drizzle ORM · Neon Postgres · Tailwind ·
Vercel · pnpm

Server Actions for mutations. No separate API layer in v1.

## Layout

```
/app                 routes
/catalog             card product JSON — the public seed data
/db/schema.ts        Drizzle schema — the source of truth
/db/schema.sql       generated full DDL snapshot; regenerate with `pnpm db:schema`
/db/migrations       generated; never hand-edited
/lib/catalog         catalog Zod schema, loader, and catalog→row mapping
/lib/date            PlainDate (pure) and todayIn (the only clock reader)
/lib/gate            household PIN gate: token, config, attempt limits
/lib/periods         period engine (pure, no I/O)
/lib/ledger          potential/captured/forfeited/available math
/scripts/seed.ts     idempotent catalog seeding
```

## Migrations

**Increment. Never squash.** As of 2026-08-02 the schema is deployed to the production Neon
branch, so `db/migrations` is a real history that a real database has replayed. Deleting and
regenerating it would break the `drizzle-kit migrate` journal and leave production
unmigratable.

Schema changes are made by editing `db/schema.ts` and generating the next migration:

```
pnpm db:generate     # writes the next NNNN_*.sql — never delete the earlier ones
pnpm db:migrate      # apply, using the DIRECT (non-pooled) Neon connection string
```

`db/schema.ts` stays the source of truth; the migrations are how a database catches up to it.
`pnpm db:push` is fine for a scratch database, never for production.

**`db/schema.sql` is generated and must never be stale.** It is the full current schema in
one file, so someone can read or apply it without replaying a migration history. Regenerate
it in the same change as any schema edit:

```
pnpm db:schema       # regenerate db/schema.sql from db/schema.ts
pnpm db:schema:check # fails if it has drifted — also runs inside pnpm test
```

Never hand-edit `db/schema.sql`. A generated file nobody regenerates is worse than no file:
it looks authoritative while describing a schema that no longer exists.

## Hard rules

1. **Money is integer cents.** Never floats, never `number` dollars. Format only at the
   render boundary.
2. **Period boundaries are `date`, never `timestamptz`.** Evaluate in the household's
   IANA timezone. Never call `new Date()` inside `/lib/periods` — `asOf` is injected.
3. **No `benefit_periods` table.** Periods are computed from benefit definition + card
   open date. If you find yourself materializing periods, stop and re-read SPEC §5.
4. **Never commit real card data.** No account numbers, no last-4, no real redemptions.
   Seed data is fictional or catalog-only.
5. **Never invent benefit amounts or reset rules.** Every catalog entry needs a
   `source_url` and `verified_on` from actual issuer terms. If you don't have the source,
   leave a TODO — do not fill in a plausible number.
6. **No issuer logos or card art.** Text product names only.
7. Only `benefit_type = 'credit'` enters ledger math. Perks never appear in a total.

## Testing

`/lib/periods` and `/lib/ledger` are the parts that must not be wrong. Both need real
coverage before their consumers get built.

- Every reset type in SPEC §5.2 gets a test.
- Every edge case in SPEC §5.3 gets a named test.
- The ledger invariant `captured + forfeited + available === potential` is asserted
  against generated fixtures, not just one happy path.
- Tests inject `asOf`. A test that depends on the real clock is a broken test.

## UI conventions

Design tokens are fixed in SPEC §6 — don't introduce new colors or typefaces.

- IBM Plex Mono with tabular figures for every dollar amount and date
- Amber = expiring, teal = captured, maroon = forfeited. Don't reuse them for anything else.
- One motion moment (cliff strip on load). Resist adding more.
- Responsive to 360px, visible keyboard focus, `prefers-reduced-motion` honored.

## Copy

Sentence case. Active voice. Name things by what the person controls, not how the system
works. An action keeps the same name through the whole flow: the button says "Mark used,"
the toast says "Marked used." Errors say what happened and how to fix it. Empty states
invite an action.

## Commands

```
pnpm dev
pnpm db:generate     # drizzle-kit generate
pnpm db:migrate
pnpm seed            # idempotent catalog upsert
pnpm test
pnpm lint
```

## Definition of done

- `pnpm test` and `pnpm lint` pass
- No new `any`
- Schema changes have a generated migration **and** a regenerated `db/schema.sql`
  committed alongside
- Catalog changes pass Zod validation and carry `verified_on`
- Nothing user-identifying added to the repo
