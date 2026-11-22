import { describe, expect, it } from 'vitest'
import {
  UNLOCK_TTL_SECONDS,
  constantTimeEqual,
  createUnlockToken,
  pinMatches,
  safeNextPath,
  verifyUnlockToken,
} from './token'

const secrets = { pin: '482913', secret: 'test-secret-not-real' }
const NOW = 1_800_000_000

describe('unlock token', () => {
  it('verifies a token it created', async () => {
    const token = await createUnlockToken(secrets, NOW)
    expect(await verifyUnlockToken(token, secrets, NOW + 60)).toBe(true)
  })

  it('expires after the TTL', async () => {
    const token = await createUnlockToken(secrets, NOW)
    expect(await verifyUnlockToken(token, secrets, NOW + UNLOCK_TTL_SECONDS - 1)).toBe(true)
    expect(await verifyUnlockToken(token, secrets, NOW + UNLOCK_TTL_SECONDS)).toBe(false)
  })

  it('is invalidated when the PIN changes', async () => {
    const token = await createUnlockToken(secrets, NOW)
    expect(await verifyUnlockToken(token, { ...secrets, pin: '000000' }, NOW)).toBe(false)
  })

  it('is invalidated when the secret changes', async () => {
    const token = await createUnlockToken(secrets, NOW)
    expect(await verifyUnlockToken(token, { ...secrets, secret: 'other' }, NOW)).toBe(false)
  })

  it('rejects a token whose expiry was pushed out', async () => {
    const token = await createUnlockToken(secrets, NOW)
    const [, signature] = token.split('.')
    const extended = `${NOW + UNLOCK_TTL_SECONDS * 10}.${signature}`
    expect(await verifyUnlockToken(extended, secrets, NOW)).toBe(false)
  })

  it('rejects missing and malformed tokens', async () => {
    for (const token of [undefined, '', 'abc', '123.', '.deadbeef', `${NOW}.${'g'.repeat(64)}`]) {
      expect(await verifyUnlockToken(token, secrets, NOW)).toBe(false)
    }
  })
})

describe('pinMatches', () => {
  it('matches only the exact PIN', async () => {
    expect(await pinMatches('482913', '482913')).toBe(true)
    expect(await pinMatches('482914', '482913')).toBe(false)
    expect(await pinMatches('48291', '482913')).toBe(false)
    expect(await pinMatches('', '482913')).toBe(false)
  })
})

describe('constantTimeEqual', () => {
  it('compares equal and unequal strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('safeNextPath', () => {
  it('keeps same-site paths', () => {
    expect(safeNextPath('/cards/123?x=1')).toBe('/cards/123?x=1')
  })

  it('falls back to / for anything that could leave the site', () => {
    for (const value of [null, undefined, '', 'https://evil.example', '//evil.example', '/\\evil.example']) {
      expect(safeNextPath(value)).toBe('/')
    }
  })
})
