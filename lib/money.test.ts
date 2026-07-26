import { describe, expect, it } from 'vitest'
import {
  InvalidAmountError,
  formatCents,
  formatCentsCompact,
  parseDollarsToCents,
} from './money'

describe('parseDollarsToCents', () => {
  it('parses whole dollars', () => {
    expect(parseDollarsToCents('15')).toBe(1500)
    expect(parseDollarsToCents('695')).toBe(69500)
    expect(parseDollarsToCents('0')).toBe(0)
  })

  it('parses one and two decimal places', () => {
    expect(parseDollarsToCents('15.5')).toBe(1550)
    expect(parseDollarsToCents('15.50')).toBe(1550)
    expect(parseDollarsToCents('0.07')).toBe(7)
  })

  it('tolerates the ways people actually type money', () => {
    expect(parseDollarsToCents('$15.50')).toBe(1550)
    expect(parseDollarsToCents('  15.50  ')).toBe(1550)
    expect(parseDollarsToCents('$ 15.50')).toBe(1550)
    expect(parseDollarsToCents('1,234.56')).toBe(123456)
  })

  it('rejects more than two decimals rather than rounding money away', () => {
    expect(() => parseDollarsToCents('1.005')).toThrow(InvalidAmountError)
    expect(() => parseDollarsToCents('15.555')).toThrow(InvalidAmountError)
  })

  it('rejects junk', () => {
    for (const bad of ['', '   ', 'abc', '15.', '.50', '1.2.3', '15,5', '$']) {
      expect(() => parseDollarsToCents(bad), bad).toThrow(InvalidAmountError)
    }
  })

  it('never returns a float', () => {
    for (const input of ['15', '15.5', '15.55', '0.01', '9999.99']) {
      expect(Number.isInteger(parseDollarsToCents(input))).toBe(true)
    }
  })

  it('round-trips through formatCents', () => {
    for (const cents of [0, 1, 7, 100, 1500, 1550, 69500, 123456]) {
      expect(parseDollarsToCents(formatCents(cents, { alwaysCents: true }))).toBe(cents)
    }
  })
})

describe('formatCents', () => {
  it('drops .00 on whole dollars', () => {
    expect(formatCents(1500)).toBe('$15')
    expect(formatCents(69500)).toBe('$695')
  })

  it('keeps cents when there are any', () => {
    expect(formatCents(1550)).toBe('$15.50')
    expect(formatCents(7)).toBe('$0.07')
    expect(formatCents(1505)).toBe('$15.05')
  })

  it('can force cents for column alignment', () => {
    expect(formatCents(1500, { alwaysCents: true })).toBe('$15.00')
  })

  it('groups thousands', () => {
    expect(formatCents(123456)).toBe('$1,234.56')
    expect(formatCents(1000000)).toBe('$10,000')
  })

  it('uses a real minus sign for negatives, as in fee recovery', () => {
    expect(formatCents(-69500)).toBe('−$695')
    expect(formatCents(-1550)).toBe('−$15.50')
  })

  it('formats zero plainly', () => {
    expect(formatCents(0)).toBe('$0')
  })
})

describe('formatCentsCompact', () => {
  it('leaves small amounts alone', () => {
    expect(formatCentsCompact(1500)).toBe('$15')
    expect(formatCentsCompact(69500)).toBe('$695')
  })

  it('abbreviates thousands', () => {
    expect(formatCentsCompact(1250000)).toBe('$12.5k')
    expect(formatCentsCompact(10000000)).toBe('$100k')
  })
})
