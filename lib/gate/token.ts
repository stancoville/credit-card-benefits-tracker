/**
 * The household PIN gate's unlock token (SPEC §10).
 *
 * After a correct PIN, the browser gets a cookie holding `<expiresAt>.<signature>`, where
 * the signature is an HMAC over the expiry and a hash of the current PIN. That gives three
 * properties without a sessions table:
 *
 *   - It can't be forged without `UNLOCK_SECRET`.
 *   - It expires on its own, after {@link UNLOCK_TTL_SECONDS}.
 *   - Changing `HOUSEHOLD_PIN` invalidates every existing cookie, so a new PIN locks out
 *     any browser that was unlocked with the old one.
 *
 * Pure and runtime-agnostic: Web Crypto only, and `nowSeconds` is injected so tests never
 * read the clock. Both the proxy and the server actions verify with this module.
 */

export const UNLOCK_COOKIE = 'household_unlock'

/** 90 days. Long enough that two people on their own phones rarely see the PIN screen. */
export const UNLOCK_TTL_SECONDS = 90 * 24 * 60 * 60

export interface GateSecrets {
  pin: string
  secret: string
}

const encoder = new TextEncoder()

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

async function sign(expiresAt: number, secrets: GateSecrets): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secrets.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const message = `${expiresAt}:${await sha256Hex(secrets.pin)}`
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))
}

/** Compares without short-circuiting, so timing doesn't reveal how much matched. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function createUnlockToken(
  secrets: GateSecrets,
  nowSeconds: number,
): Promise<string> {
  const expiresAt = nowSeconds + UNLOCK_TTL_SECONDS
  return `${expiresAt}.${await sign(expiresAt, secrets)}`
}

export async function verifyUnlockToken(
  token: string | undefined,
  secrets: GateSecrets,
  nowSeconds: number,
): Promise<boolean> {
  if (!token) return false
  const match = /^(\d{1,12})\.([0-9a-f]{64})$/.exec(token)
  if (!match) return false
  const expiresAt = Number(match[1])
  if (expiresAt <= nowSeconds) return false
  return constantTimeEqual(match[2] as string, await sign(expiresAt, secrets))
}

/** Whether a submitted PIN matches. Hashes both sides so the comparison length is fixed. */
export async function pinMatches(submitted: string, pin: string): Promise<boolean> {
  return constantTimeEqual(await sha256Hex(submitted), await sha256Hex(pin))
}

/**
 * Where to send someone after they unlock. Only same-site paths: `//evil.example` and
 * `/\evil.example` are protocol-relative URLs to another host, so they're refused.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/'
  }
  return value
}
