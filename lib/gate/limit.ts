/**
 * Wrong-PIN limits (SPEC §10). A short PIN is only safe if it can't be guessed quickly.
 *
 * Two limits, both counted from `unlock_attempts`:
 *
 *   - **Per address:** {@link PER_IP_MAX_FAILURES} wrong tries in
 *     {@link PER_IP_WINDOW_MINUTES} minutes locks that address out. This is the one a
 *     fat-fingered household member might hit.
 *   - **Everyone:** {@link GLOBAL_MAX_FAILURES} wrong tries from all addresses in
 *     {@link GLOBAL_WINDOW_MINUTES} minutes locks the PIN screen for everyone. This stops a
 *     guesser who rotates addresses. It can lock the household out during an attack, which
 *     is the right trade: a locked door beats an open one.
 *
 * At these limits a 4-digit PIN takes about 10 days on average to guess by rotating
 * addresses; a 6-digit PIN takes years.
 */

export const PER_IP_MAX_FAILURES = 5
export const PER_IP_WINDOW_MINUTES = 15
export const GLOBAL_MAX_FAILURES = 20
export const GLOBAL_WINDOW_MINUTES = 60

/** How long attempt rows are kept. Only the windows above are ever read. */
export const ATTEMPT_RETENTION_HOURS = 24

export type Lockout = 'none' | 'address' | 'everyone'

export function lockoutFor(counts: { ipFailures: number; globalFailures: number }): Lockout {
  if (counts.globalFailures >= GLOBAL_MAX_FAILURES) return 'everyone'
  if (counts.ipFailures >= PER_IP_MAX_FAILURES) return 'address'
  return 'none'
}
