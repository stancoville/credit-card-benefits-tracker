import { describe, expect, it } from 'vitest'
import { gateConfig } from './config'
import { GLOBAL_MAX_FAILURES, PER_IP_MAX_FAILURES, lockoutFor } from './limit'

describe('gateConfig', () => {
  const configured = { HOUSEHOLD_PIN: '482913', UNLOCK_SECRET: 's3cret' }

  it('is on when the PIN and secret are set', () => {
    expect(gateConfig({ ...configured, NODE_ENV: 'production' })).toEqual({
      mode: 'on',
      secrets: { pin: '482913', secret: 's3cret' },
    })
  })

  it('is open in demo mode, even with a PIN set', () => {
    expect(gateConfig({ ...configured, DEMO_MODE: 'true', NODE_ENV: 'production' })).toEqual({
      mode: 'open',
    })
  })

  it('fails closed in production when the PIN is missing', () => {
    expect(gateConfig({ UNLOCK_SECRET: 's3cret', NODE_ENV: 'production' })).toEqual({
      mode: 'misconfigured',
    })
  })

  it('fails closed in production when the secret is missing', () => {
    expect(gateConfig({ HOUSEHOLD_PIN: '482913', NODE_ENV: 'production' })).toEqual({
      mode: 'misconfigured',
    })
  })

  it('treats a too-short or blank PIN as missing', () => {
    for (const pin of ['', '   ', '123']) {
      expect(
        gateConfig({ HOUSEHOLD_PIN: pin, UNLOCK_SECRET: 's3cret', NODE_ENV: 'production' }),
      ).toEqual({ mode: 'misconfigured' })
    }
  })

  it('is open in development when unconfigured, so a fresh clone runs', () => {
    expect(gateConfig({ NODE_ENV: 'development' })).toEqual({ mode: 'open' })
  })
})

describe('lockoutFor', () => {
  it('allows attempts under both limits', () => {
    expect(lockoutFor({ ipFailures: PER_IP_MAX_FAILURES - 1, globalFailures: 0 })).toBe('none')
  })

  it('locks an address at the per-address limit', () => {
    expect(lockoutFor({ ipFailures: PER_IP_MAX_FAILURES, globalFailures: 0 })).toBe('address')
  })

  it('locks everyone at the global limit, whatever this address has done', () => {
    expect(lockoutFor({ ipFailures: 0, globalFailures: GLOBAL_MAX_FAILURES })).toBe('everyone')
  })
})
