# Credit Card Benefits Tracker — Spec

Status: draft for build. Owner: Stan.

## 1. What this is

A tracker for recurring credit card benefits (statement credits, monthly allowances,
enrollment-gated offers) across a household's premium cards.

The app has two jobs, in this order:

1. **Tell me what money is about to evaporate.** The deadline view is the default because
   it is the only one that is time-critical.
2. **Let me evaluate value captured — per card and overall, over a period.** Is this card
   earning its fee? Did we capture more this year than last?

The organizing goal behind both: **maximize the value actually captured.** That is why
missed value stays visible in the totals rather than being quietly dropped (see §4).

_Amended 2026-07-26: job 2 was previously folded into "everything else is secondary."
It isn't secondary — it's the reason the four-way ledger split and the Cards lens exist.
Job 1 still wins ties in the UI: the dashboard defaults to deadlines (§6)._

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
periods are `date`, never `timestamptz` (see §5.4). Every `date` column is typed
`PlainDate` in application code via Drizzle's `mode: 'string'`, so a calendar date is
never handled as an instant (see §5.1, amendment 1).

Two things exist in `/db/schema.ts` that the column lists below don't name:

- **`created_at timestamptz` on the six ledger tables.** A row's creation time is a true
  instant, not a calendar day, so `timestamptz` is correct here and only here.
- **Check constraints for the invariants stated in prose.** A credit requires a
  `max_value` (§3.1 + hard rule 7), `reset_interval >= 1` (§5.2), effective and open/close
  windows are ordered, and money is non-negative. These enforce existing rules rather
  than adding new ones.

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
  occurred_on   date                 -- may fall in a closed period; see §4 true-ups
  note          text null            -- free text, e.g. which hotel the credit was used at
  source        enum('manual','reminder') not null default 'manual'
  index (user_card_id, benefit_id, period_start)
```

`source` resolves the last item in §10. Email reminders are deferred from v1, but the
column ships now: adding a column later is trivial, while recovering the *meaning* of rows
written before it existed is not.

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

_The rules below were decided 2026-07-26. §4.1–4.3 and §4.5 were settled before the ledger
module was written; §4.4 was found afterwards, by running the app against a real database._

### 4.1 Which card year owns a period

A period belongs to the card year containing its **`periodEnd`** — its deadline.

This has to be stated because overlap is ambiguous and expensive to get wrong. A calendar
`annual` credit runs Jan 1–Dec 31 while a card year runs, say, Mar 10–Mar 9, so two
successive credit periods both overlap one card year. Summing by overlap would count that
credit twice in `potential` and turn fee recovery into fiction. Assigning by `periodEnd`
gives every period exactly one owner, which is what keeps the invariant true.

It also matches how a person acts: the deadline is the thing you respond to.

The same rule makes job 2 in §1 cheap — group the identical period set by the calendar
year containing `periodEnd` instead of the card year, and you have a calendar-year view
with no new engine work. Card year remains the default because it is what the annual fee
buys.

### 4.2 Enrollment is a lapse, not an exclusion

An unenrolled credit **stays in `potential`**. While its period is open it sits in
`available`; when the period closes still unenrolled, it becomes `forfeited`.

`excluded` means "not applicable to us" — a deliberate, standing judgment. Not-enrolled is
a **lapse**, and a lapse about to expire is the most actionable thing the app can show.
Dropping it from `potential` would hide missed value, which is the opposite of the goal in
§1.

So enrollment changes a row's state and its action verb ("Enroll", louder styling per §6),
never the arithmetic. For display, `available` splits into enrolled and not-enrolled — a
partition of one term, so the invariant is untouched.

### 4.3 True-ups: redemptions may be backdated into closed periods

Because every redemption is entered by hand, people will reconcile late — recording a
credit they used in June during August. This is supported, and it is why there is no
"was it really available?" override on `forfeited`: the number stays derived from facts
(a redemption with a date) rather than from an opinion about a number.

The rules that make it safe:

- **`occurred_on` decides the period.** `period_start` is always derived server-side by
  passing `occurred_on` to `periodFor`, never accepted from the client, so the key cannot
  disagree with the date.
- **A date with no period is rejected**, with a message naming the reason: before the card
  was opened, after it was closed, or outside the benefit's effective window. `periodFor`
  returning null *is* the validation.
- **Ledger figures are always recomputed, never cached.** A true-up moves value from
  `forfeited` to `captured` in a period that already closed, so any stored total would
  silently drift out of agreement. Same reasoning as having no `benefit_periods` table.
- **A period's captured value cannot exceed its `max_value`.** Reject the excess and say
  how much room is left; otherwise `available` goes negative and the invariant, while
  still arithmetically true, becomes nonsense.

Consequence to accept: historical figures are not final. A past month's `forfeited` can
fall when someone reconciles. The UI must never present a past figure as settled.

### 4.4 `applies_to` gates whether a benefit reaches a card

A benefit only counts on a card whose holder it actually reaches (§3.1):

| `applies_to` | Counts on a primary card | Counts on an authorized user card |
|---|---|---|
| `primary` | yes | **no** |
| `authorized_user` | **no** | yes |
| `both` | yes | yes |

This was missed in the first ledger implementation and found by running the app against a
real database: an authorized user card was accruing `primary`-only credits, inflating
`potential` with money nobody could claim — which then forfeited and reported a loss that
never existed.

A benefit that does not reach a card is **not** the same as an excluded one. `excluded` is a
household's judgment about a benefit it *has*; this benefit simply is not on the card, so it
appears in neither figure. The drill-in still lists it, marked as not counted, because
knowing the product carries it is useful.

### 4.6 Estimated-value benefits: a certificate is worth what you got for it

Some benefits have no dollar cap. A Marriott free night award used on a $500 room captured
$500; used on a $180 room it captured $180. `benefits.value_mode` distinguishes them:

| `value_mode` | `max_value` means | Redemption |
|---|---|---|
| `fixed` | a cap set by the issuer | capped at `max_value` |
| `estimated` | a default estimate for planning | records the **realized** value, uncapped |

**`potential` becomes partly derived from redemptions.** For an estimated benefit the
realized value *replaces* the estimate once recorded. The alternatives are both wrong:
capping captured at the estimate silently discards real value, and letting it exceed the
estimate drives `available` negative. Replacing keeps the money and the invariant.

- unused → potential = estimate, available = estimate
- used for $500 → potential = $500, captured = $500, available = $0
- expired unused → potential = estimate, forfeited = estimate

**An estimate is not an issuer term**, so it cannot share a field or a provenance story with
a verified credit amount (hard rule 5). Two consequences:

- `estimate_basis` is **required** whenever `value_mode = 'estimated'`, and says how the
  number was derived — e.g. "35k-point award cap at 0.6c/pt per TPG August 2026 valuations".
  Points-valuation sites are an acceptable source *for estimates only*; stated credit amounts
  still come from the issuer.
- `LedgerTotals.estimated` reports how much of `potential` rests on an estimate, and any
  figure containing it must say so. A total that quietly mixes measured and guessed value is
  the kind of number that stops being trusted.

### 4.7 Spend-gated value is `unlockable`, not `available`

Some benefits exist only after a spend threshold: the Marriott Bevy and Bountiful free
nights need $15,000 of calendar-year spend, the Amex Marriott Business second award needs
$60,000. `benefits.unlock_spend` records the threshold; null means unconditional.

That value is real and must be **shown**, but it is not `available`. Forgetting to enrol is
a lapse you can fix in seconds, so it belongs in the total (§4.2). Not having spent $15,000
may be permanently out of reach, and putting it in "expiring in 30 days" would make the one
figure the app exists to make actionable something you cannot act on.

So it is reported as **`unlockable`**, beside the four-way split, exactly where `excluded`
sits. Until something is recorded against it, such a period contributes nothing to
`potential`, `available` or `forfeited`, and appears in `unlockableRows` with its threshold
and deadline. Record a redemption and it counts normally from then on.

**It never forfeits.** The app does not track spend, so it cannot know whether the threshold
was met. Reporting a loss it cannot substantiate would be worse than reporting nothing — the
honest cost being that an unlocked-but-unused award is not warned about. Tracking spend, or
letting the household mark a threshold as met, would close that gap; neither is in v1.

### 4.5 Timezone is per household, not per user

`households.timezone` is the single source (resolving the first item in §10). This is a
correctness constraint, not a preference: `period_start` is a shared key, so two members
resolving `asOf` in different zones could compute different keys for the same period and
write duplicate or unreachable redemption rows.

Fee recovery (`captured − annual_fee`) is a drill-in figure, not a dashboard figure.

**Capture pace** = `captured / potential` compared against `elapsed / 365` of the card
year. Ahead → teal, behind → amber. Implemented against the card year's *true* length
rather than a literal 365, so a leap year does not report 100.3% elapsed and a card year
truncated by closure paces against its actual span. `potential` of 0 yields `unknown`
rather than a division by zero.

---

## 5. The period engine

This is the core of the app. Build and test it before any UI.

### 5.1 Contract

_Amended 2026-07-26, when the engine was built. The original draft typed every boundary
as `Date` and passed `tz` as the fourth argument; three changes were needed to make it
implementable. Each is noted below._

```ts
/** Branded 'YYYY-MM-DD'. See /lib/date/plain-date.ts. */
type PlainDate = string

function periodFor(
  benefit: PeriodBenefit,
  cardOpenedOn: PlainDate,
  asOf: PlainDate,
  context: PeriodContext
): BenefitPeriod | null

function periodsInRange(
  benefit: PeriodBenefit,
  cardOpenedOn: PlainDate,
  from: PlainDate,
  to: PlainDate,
  context: PeriodContext
): BenefitPeriod[]

interface PeriodBenefit {
  resetType: ResetType
  resetInterval: number
  resetAnchor: ResetAnchor
  effectiveFrom: PlainDate
  effectiveTo: PlainDate | null
}

interface PeriodContext {
  tz: string                    // household timezone; accepted, not consumed — see §5.4
  cardClosedOn?: PlainDate      // user_cards.closed_on
  oneTimeRedeemed?: boolean     // resolved by the caller from redemptions
}

interface BenefitPeriod {
  periodStart: PlainDate        // inclusive; the redemptions/enrollments key
  periodEnd: PlainDate | null   // inclusive; null only for open-ended one_time
  isPartial: boolean            // informational; full max_value counts regardless
}
```

Pure functions. No DB access, no `new Date()` inside — `asOf` is always injected. A lint
rule enforces this for `/lib/periods` and `/lib/ledger`.

**Amendment 1 — dates are `PlainDate`, not `Date`.** A JS `Date` is an instant, not a
calendar date: `new Date('2026-07-31')` is UTC midnight and renders as Jul 30 in
`America/New_York`. Typing boundaries as `Date` would guarantee the bug §5.4 exists to
prevent. A branded `YYYY-MM-DD` string cannot drift, is what Drizzle's `date` column
returns in `mode: 'string'` (so no conversion layer exists to get wrong), sorts
chronologically under both SQL `ORDER BY` and JS `.sort()`, and crosses the Server
Component → Server Action boundary without a serializer.

**Amendment 2 — a fourth `context` argument.** Two §5.3 cases are unreachable from the
original signature: an already-redeemed `one_time` benefit and a card closed mid-year.
Neither is derivable from a benefit definition plus an open date. The caller resolves
both and passes them in, so the functions stay pure and both cases stay testable inside
the engine rather than leaking into the ledger.

**Amendment 3 — `periodEnd` is nullable.** A `one_time` offer with no `effective_to` has
no deadline, so its period never closes and can never be forfeited. Every other reset
type always returns a non-null `periodEnd`.

`PeriodBenefit` is the subset of a benefit definition that determines periods — it is
structurally satisfied by a `benefits` row, so a DB row can be passed directly, but the
engine can also be called with a catalog JSON entry or a test fixture.

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

Base period lengths, in months: `monthly` 1, `quarterly` 3, `semiannual` 6, `annual` 12,
`rolling` 12. **`rolling` counts years** — its interval is a year count, so Global Entry
at interval 4 is a 48-month period. It shares its arithmetic with `annual`; the two
differ in catalog intent, not behavior. `one_time` has no length and takes a separate
path.

**Anchoring.** `calendar` aligns the sequence to the Jan 1 epoch, so every household sees
identical boundaries for the same benefit — that is what makes a quarter *the issuer's*
quarter. Intervals that divide 12 therefore land where issuers publish them: quarters on
Jan/Apr/Jul/Oct, semiannual on Jan–Jun / Jul–Dec, annual dying Dec 31.

`card_open` measures every boundary from the original open date rather than from the
previous boundary, which is what stops a card opened on the 31st from drifting: Jan 31 →
Feb 28 → Mar 31, not Mar 28.

### 5.3 Edge cases that need explicit tests

- Card opened Feb 29. Anniversary in non-leap years → Feb 28.
- Card opened on the 31st. Monthly periods in 30-day months → last day of month.
- Card opened mid-period. The first period is **short**, not skipped. `potential` for a
  partial first period still counts the full `max_value` — issuers don't prorate.
  `periodStart` **clamps to the open date**: a card opened Jan 15 with a monthly calendar
  credit yields Jan 15–31, keyed `2026-01-15`, not `2026-01-01`. The period is genuinely
  short, so its key says so. Consequence to accept: correcting a typo'd `opened_on`
  orphans that first period's redemption rows.
- Benefit whose `effective_to` falls mid-card-year. Periods after that date don't
  exist; periods before still count toward `forfeited`. The period **containing**
  `effective_to` is **truncated and counts its full `max_value`** — symmetric with the
  short first period above, and a credit usable Aug 1–10 must not vanish from the
  dashboard.
- Card closed mid-year (`closed_on`). No periods after closure. The period containing
  the closure date is truncated the same way. Where closure and `effective_to` both
  apply, the earlier wins.
- `one_time` benefit already redeemed → `periodFor` returns null, and `periodsInRange`
  returns `[]`. Supplied via `context.oneTimeRedeemed` — see amendment 2 in §5.1.

A period clamped on either side is flagged `isPartial`. That flag is informational only:
the engine deliberately emits **no proration factor**, so there is nothing a caller could
multiply an amount by.

### 5.4 Timezone

Every boundary is a **calendar date** in `households.timezone`. Compute with the
household tz, store as `date`, never `timestamptz`. "Expires Jul 31" must not shift
because the server is in UTC.

`asOf` is derived server-side from the household timezone, never from the browser.

The conversion happens once, at the edge: `todayIn(tz)` in `/lib/date/now.ts` is the only
place in the app that reads the clock. It returns a `PlainDate`, which is what every
downstream function takes.

This is why `context.tz` is accepted but never read. Once `asOf` is a calendar date
already resolved in the household zone, there is no instant left to interpret and a
timezone cannot change the answer — there is a test asserting exactly that. The field
stays in the signature so callers cannot lose track of which zone their dates came from.

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

1. ~~Drizzle schema + migrations~~ — done 2026-07-26
2. ~~Period engine + full test suite (§5.3)~~ — done 2026-07-26. **Before any UI.**
3. Catalog validator + idempotent `pnpm seed` — done 2026-07-26. Catalog population is
   ongoing: amounts come from issuer terms, never from recall (§7), so entries land as
   they are verified rather than all at once.
4. ~~Ledger math module + invariant tests (§4)~~ — done 2026-07-26
5. ~~Dashboard: hero, ledger bar, cliff strip, deadline groups~~ — done 2026-07-26
6. ~~Mark used / enroll flows~~ — done 2026-07-26
7. ~~Cards lens + drill-in~~ — done 2026-07-26
8. Demo mode, seed script, nightly reset cron
9. Password gate, subdomains, DNS

---

## 10. Open decisions

_All five resolved 2026-07-26._

- [x] **Household timezone: single value.** Not a preference — `period_start` is a shared
      key, so per-user zones could fork it. See §4.4.
- [x] **Partial redemption UI on mobile: an explicit amount field**, as a secondary control
      on the same sheet. Long-press has no visible affordance, no keyboard equivalent, and
      no accessible name, which collides with the quality floor in §6. The one-gesture path
      is preserved: the primary action commits the full remaining amount.
- [x] **`forfeited` needs no override.** Backdated true-ups cover the real case, and they
      keep the figure derived from a dated fact instead of an opinion. See §4.3.
- [x] **No auth in v1, and none planned for this deployment.** Cards attach to `users` rows
      so value can be attributed per person; that is the only reason `users` exists.
      Access control is Vercel Deployment Protection on production (§2), not application
      code. Self-hosters add their own. `users.email` is the only personal data in the
      schema and lives in Neon only — never the repo (§1, hard rule 4).
- [x] **`redemptions.source` ships now**, `enum('manual','reminder')` defaulting to
      `manual`. Shipped in migration 0001. See §3.2.
