/**
 * Public surface of the period engine (SPEC §5).
 *
 * Consumers import from `@/lib/periods` only. Nothing here reads the clock or the
 * database; `asOf` is injected by the caller from `lib/date/now.ts`.
 */

export { periodFor, periodsInRange, isPeriodClosed, periodKey, comparePeriods } from './engine'

export {
  InvalidBenefitDefinitionError,
  type BenefitPeriod,
  type PeriodBenefit,
  type PeriodContext,
  type ResetAnchor,
  type ResetType,
} from './types'
