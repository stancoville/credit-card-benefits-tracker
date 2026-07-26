# Catalog

Card products and their benefits. This is the open-source asset — it is identical for
every deployment, and **no household data ever appears here** (SPEC §1).

## Layout

```
issuers.json                        slug → display name
<issuer-slug>/<product-slug>.json   one file per card product
_template/                          shape reference; validated, never seeded
```

The filename must match `product.slug`, and the directory must match `product.issuer`,
which must exist in `issuers.json`. The validator enforces all three.

Anything starting with `_` or `.` is skipped by the seeder. That is how `_template/`
documents the format without putting a fictional product into a real database.

## The rule that matters

**Every amount must come from current issuer terms, with a `source_url` and a
`verified_on` date.** Not from memory, not from a blog post, not from an LLM — these
change constantly, and a wrong number is worse than a missing one (SPEC §7).

If you don't have the source, leave the benefit out and open an issue. A catalog with
gaps is honest; a catalog with plausible guesses is not.

`pnpm test` validates every file. It will reject a missing `source_url`, a missing
`verified_on`, a `verified_on` in the future, a credit with no value, a perk *with* a
value, a float in a `_cents` field, an unknown key, and a duplicate slug.

## Shape

See `_template/example-premium-card.json`. Fields:

| Field | Notes |
|---|---|
| `benefit_type` | `credit` enters ledger math; `perk` never appears in a total |
| `max_value_cents` | integer cents, required for credits, forbidden for perks |
| `reset_type` | `monthly` · `quarterly` · `semiannual` · `annual` · `rolling` · `one_time` |
| `reset_anchor` | `calendar` aligns to Jan 1; `card_open` aligns to the account anniversary |
| `reset_interval` | multiplies the base period; `rolling` counts years (SPEC §5.2) |
| `applies_to` | `primary` · `authorized_user` · `both` |
| `merchant_scope` | free text, e.g. "Example merchant, rides and delivery" |
| `effective_to` | omit while a benefit is current; set it when the benefit ends |

Money is integer cents everywhere: $695.00 is `69500`. A float is a unit error and is
rejected.

## No logos, no card art

Text product names only. Card designs and marks are trademarked (SPEC §8). Objects are
validated strictly, so an added `logo_url` field fails the build rather than shipping.
