/**
 * Public surface of the ledger math (SPEC §4).
 *
 * Pure functions over injected values. `asOf` comes from `lib/date/now.ts` at the edge.
 */

export {
  benefitAppliesToCard,
  cardYearFor,
  ledgerForCardYear,
  ledgerInvariantHolds,
  sumTotals,
  totalsFor,
} from './ledger'

export type {
  CapturePace,
  CardYearLedger,
  LedgerBenefit,
  LedgerCard,
  LedgerEnrollment,
  LedgerInput,
  LedgerRedemption,
  LedgerRow,
  LedgerTotals,
} from './types'
