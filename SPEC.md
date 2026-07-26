# Credit Card Benefits Tracker — Spec

Status: draft for build. Owner: Stan.

## 1. What this is

A tracker for recurring credit card benefits (statement credits, monthly allowances,
enrollment-gated offers) across a household's premium cards.

The app's single job: **tell me what money is about to evaporate.**

Everything else — fee math, history, card detail — is secondary to that.

### Two data planes

| Plane | Lives in | Scope |
|---|---|---|
| **Catalog** | Repo, as JSON, seeded into DB | Card products and their benefits. Identical for every deployment. |
| **Ledger** | Neon only | Which cards a household holds, and what they've redeemed. |

The catalog is the open-source asset. No user data ever ships in the repo.

### Non-goals for v1

- Bank/transaction import or auto-detection of credit posting
- Points/miles valuation, award search, or transfer partners
- Mobile app; responsive web only
- Multi-tenant SaaS. Households exist in the schema, but auth is deferred.

---

## 2. Environments

| | Production | Demo |
|---|---|---|
| Domain | `cards.stancoville.com` | `demo.cards.stancoville.com` |
| Neon | `main` branch | `demo` branch |
| Gate | Vercel Deployment Protection (password) | Open |
| Data | Real household | Seeded fake household |
| Reset | Never | Nightly cron: truncate + reseed |

Preview deployments point at the `demo` branch. Real data must never appear in a
preview build.

`DEMO_MODE=true` shows a persistent banner and disables anything destructive.

---

## 3. Data model

Money is stored as **integer cents**. Never floats. Dates that represent benefit
periods are `date`, never `timestamptz` (see §5.4).

### 3.1 Catalog tables (seeded from repo)

```
issuers
  id            uuid pk
  slug          text unique          -- 'amex', 'chase'
  name          text

card_products
  id            uuid pk
  issuer_id     uuid fk
  slug          text unique          -- 'amex-platinum-consumer'
  name          text
  annual_fee    integer              -- cents
  effective_from date
  effective_to   date null

benefits
  id                 uuid pk
  product_id         uuid fk
  slug               text            -- unique per (product, effective window)
  name               text
  benefit_type       enum('credit','perk')
  max_value          integer null    -- cents; null for perks
  reset_type         enum(...)       -- see §5.1
  reset_interval     integer         -- n periods, default 1
  reset_anchor       enum('calendar','card_open')
  requires_enrollment boolean
  applies_to         enum('primary','authorized_user','both')
  merchant_scope     text null       -- 'Uber Eats and rides', free text
  notes              text null
  source_url         text            -- issuer T&C
  verified_on        date
  effective_from     date
  effective_to       date null
```

Only `benefit_type = 'credit'` rows participate in ledger math. Perks render in the
card drill-in as a list and are excluded from every total.

### 3.2 Ledger tables (private)

```
households
  id            uuid pk
  name          text
  timezone      text                 -- IANA, e.g. 'America/New_York'

users
  id            uuid pk
  household_id  uuid fk
  display_name  text
  email         text
  -- no auth columns in v1; added later without touching anything else

user_cards
  id            uuid pk
  household_id  uuid fk
  product_id    uuid fk
  owner_user_id uuid fk
  nickname      text null
  opened_on     date                 -- anchors all cardmember-year periods
  closed_on     date null
  is_authorized_user boolean
  annual_fee_override integer null

benefit_exclusions               -- "not applicable to us"
  user_card_id  uuid fk
  benefit_id    uuid fk
  reason        text null
  pk (user_card_id, benefit_id)

enrollments
  user_card_id  uuid fk
  benefit_id    uuid fk
  period_start  date
  enrolled_on   date
  pk (user_card_id, benefit_id, period_start)

redemptions
  id            uuid pk
  user_card_id  uuid fk
  benefit_id    uuid fk
  period_start  date                 -- computed, not stored as a period table
  amount        integer              -- cents; partial usage is normal
  occurred_on   date
  note          text null
  index (user_card_id, benefit_id, period_start)
```

**There is no `benefit_periods` table.** Periods are computed. This is the single most
important structural decision in the app — see §5.

---

## 4. Ledger math

All figures are scoped to a **card year** (the cardmember year anchored on
`user_cards.opened_on`), because that's the period the annual fee covers.

For a given card and card year, over `benefit_type = 'credit'` only, excluding any
benefit in `benefit_exclusions`:

```
potential  = Σ max_value over every period of every benefit falling in the card year
captured   = Σ redemptions.amount in those periods
forfeited  = Σ (max_value − redeemed) for periods that have CLOSED
available  = potential − captured − forfeited
```

Invariant: `captured + forfeited + available == potential`. Assert this in tests.

`excluded` is reported separately and is never folded into `potential` — showing it
openly is what keeps the number trustworthy.

Fee recovery (`captured − annual_fee`) is a drill-in figure, not a dashboard figure.

**Capture pace** = `captured / potential` compared against `elapsed / 365` of the card
year. Ahead → teal, behind → amber.

---

## 5. The period engine

This is the core of the app. Build and test it before any UI.

### 5.1 Contract

```ts
function periodFor(
  benefit: Benefit,
  cardOpenedOn: Date,
  asOf: Date,
  tz: string
): { periodStart: Date; periodEnd: Date } | null

function periodsInRange(
  benefit: Benefit,
  cardOpenedOn: Date,
  from: Date,
  to: Date,
  tz: string
): Array<{ periodStart: Date; periodEnd: Date }>
```

Pure functions. No DB access, no `new Date()` inside — `asOf` is always injected.

### 5.2 Reset types

| `reset_type` | Anchor | Example |
|---|---|---|
| `monthly` | calendar | Uber Cash, digital entertainment |
| `quarterly` | calendar | quarterly dining allowances |
| `semiannual` | calendar | Saks (Jan–Jun / Jul–Dec) |
| `annual` | calendar | airline fee credit (dies Dec 31) |
| `annual` | card_open | Sapphire Reserve travel credit |
| `rolling` | card_open | Global Entry, `reset_interval = 4` years |
| `one_time` | — | one-off signup offers; never resets |

`reset_interval` multiplies the base period: `monthly` with interval 3 is every three
months from the anchor.

### 5.3 Edge cases that need explicit tests

- Card opened Feb 29. Anniversary in non-leap years → Feb 28.
- Card opened on the 31st. Monthly periods in 30-day months → last day of month.
- Card opened mid-period. The first period is **short**, not skipped. `potential` for a
  partial first period still counts the full `max_value` — issuers don't prorate.
- Benefit whose `effective_to` falls mid-card-year. Periods after that date don't
  exist; periods before still count toward `forfeited`.
- Card closed mid-year (`closed_on`). No periods after closure.
- `one_time` benefit already redeemed → `periodFor` returns null.

### 5.4 Timezone

Every boundary is a **calendar date** in `households.timezone`. Compute with the
household tz, store as `date`, never `timestamptz`. "Expires Jul 31" must not shift
because the server is in UTC.

`asOf` is derived server-side from the household timezone, never from the browser.

---

## 6. Views

### Dashboard (default: deadlines)

1. **Hero — value at risk.** Big figure = unclaimed value in periods closing within 30
   days. Below it the nearest cliff: date, amount, count.
2. **Ledger bar.** One stacked bar reconciling potential = captured + forfeited +
   available, with the excluded figure and total annual fees as a footnote.
3. **Cliff strip.** 12 months forward, value expiring per month. The December cliff
   (airline credits + Saks + calendar-year annuals) should be visible without reading.
4. **Deadline groups.** Benefits grouped by period end, soonest first. Each row: name,
   card chip with owner initial, amount remaining (with partial usage shown), and one
   action.

### Cards lens

Tile per card: capture-rate ring vs. elapsed pace, card year end, count and value
expiring in 30 days. Click → drill-in with the four-way split, excluded, fee recovery,
and the perk list.

### Interaction rules

- **Mark used must be one gesture.** Default to the full remaining amount; long-press
  or a secondary control for a partial amount. If it takes four taps the data rots.
- **Not enrolled is a distinct, louder state than unused.** An unenrolled credit is
  worth $0 regardless of intent. Its action is "Enroll," not "Mark used."
- Action verbs stay constant through the flow: "Mark used" → toast "Marked used."

### Visual direction

Tokens are fixed; see the dashboard mock for the reference implementation.

- Ink `#0E1116` (hero only), paper `#F2F4F3`, amber `#E8A33D` (expiring), teal
  `#2E7D6B` (captured), maroon `#7A4A4A` (forfeited), muted `#8B93A1`
- Archivo (condensed) for display, Inter for body, IBM Plex Mono with tabular figures
  for **every** dollar amount and date
- One orchestrated motion moment: the cliff strip drawing on load. Nothing else animates.
- Quality floor: responsive to 360px, visible keyboard focus, `prefers-reduced-motion`
  respected.

---

## 7. Seed catalog

One file per card product: `/catalog/<issuer>/<product-slug>.json`.

```json
{
  "product": {
    "slug": "example-premium-card",
    "issuer": "example-issuer",
    "name": "Example Premium Card",
    "annual_fee_cents": 69500,
    "effective_from": "2025-01-01"
  },
  "benefits": [
    {
      "slug": "example-monthly-credit",
      "name": "Example monthly credit",
      "benefit_type": "credit",
      "max_value_cents": 1500,
      "reset_type": "monthly",
      "reset_anchor": "calendar",
      "reset_interval": 1,
      "requires_enrollment": false,
      "applies_to": "primary",
      "source_url": "https://…",
      "verified_on": "2026-07-01",
      "effective_from": "2025-01-01"
    }
  ]
}
```

Rules:

- Seeding is **idempotent**, upserting by `(product_slug, benefit_slug, effective_from)`.
- Every benefit requires `source_url` and `verified_on`. CI fails without them.
- Zod schema validates shape; CI runs it on every PR.
- Amounts must be verified against current issuer terms. **Do not populate from memory
  or from an LLM's recall** — these change constantly and wrong numbers are worse than
  missing ones.

### Launch coverage

Roughly 15–20 products covers the premium market. Ship those well; let PRs fill the tail.
Target the Amex consumer and business premium lineup, Chase Sapphire and Ink, Capital One
Venture X, the premium Hilton and Marriott cards, Bilt, and US Bank Altitude Reserve.

---

## 8. Public repo requirements

- MIT license.
- **No issuer logos or card art.** Text names only. Card designs and marks are
  trademarked; a public repo with LinkedIn traffic is not the place to test that.
- README: what it does, screenshot of the demo, link to the live demo, self-host steps,
  and a prominent disclaimer that benefit data is community-maintained, unofficial, and
  not guaranteed accurate.
- `.env.example` with every variable. No secrets, ever, including in seed files.
- CONTRIBUTING.md explaining the catalog JSON format and the `verified_on` requirement.

---

## 9. Build order

1. Drizzle schema + migrations
2. Period engine + full test suite (§5.3). **Before any UI.**
3. Catalog JSON + Zod validator + idempotent `pnpm seed`
4. Ledger math module + invariant tests (§4)
5. Dashboard: hero, ledger bar, cliff strip, deadline groups
6. Mark used / enroll flows
7. Cards lens + drill-in
8. Demo mode, seed script, nightly reset cron
9. Password gate, subdomains, DNS

---

## 10. Open decisions

- [ ] Household timezone: single value, or per-user? (Recommend single.)
- [ ] Partial redemption UI on mobile: long-press vs. an explicit amount field
- [ ] Does `forfeited` need a "was it really available?" override for credits that were
      technically live but practically unusable?
- [ ] Auth provider when v2 lands (Auth.js + Google with an email allowlist is the
      cheapest path that doesn't require schema changes)
- [ ] Email reminders: deferred from v1, but decide now whether `redemptions` needs a
      `source` column so reminder-driven claims are distinguishable later
