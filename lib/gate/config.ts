/**
 * Whether the household PIN gate is on, and with what secrets (SPEC §2, §10).
 *
 *   - `DEMO_MODE=true` → **open**. The demo is public by design.
 *   - `HOUSEHOLD_PIN` and `UNLOCK_SECRET` both set → **on**.
 *   - Either missing in a production build → **misconfigured**, and the gate fails closed:
 *     every page shows the PIN screen with an error and nothing can unlock it. A missing
 *     environment variable must never quietly publish the household's data.
 *   - Either missing in development → **open**, so `pnpm dev` works on a fresh clone.
 *
 * Takes the environment as an argument so it can be tested without touching `process.env`.
 */

import type { GateSecrets } from './token'

export type GateConfig =
  | { mode: 'open' }
  | { mode: 'on'; secrets: GateSecrets }
  | { mode: 'misconfigured' }

/** Short PINs are allowed (attempts are limited), but an empty or whitespace one is not. */
const MIN_PIN_LENGTH = 4

export function gateConfig(env: Record<string, string | undefined>): GateConfig {
  if (env.DEMO_MODE === 'true') return { mode: 'open' }

  const pin = env.HOUSEHOLD_PIN?.trim() ?? ''
  const secret = env.UNLOCK_SECRET?.trim() ?? ''
  if (pin.length >= MIN_PIN_LENGTH && secret.length > 0) {
    return { mode: 'on', secrets: { pin, secret } }
  }
  return env.NODE_ENV === 'production' ? { mode: 'misconfigured' } : { mode: 'open' }
}
