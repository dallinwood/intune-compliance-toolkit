import { describe, expect, it } from 'vitest'
import { formatCount, pluralize } from './format'

describe('formatCount', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [999, '999'],
    [1000, '1,000'],
    [1143, '1,143'],
    [2567, '2,567'],
  ])('writes %i as %s', (count, expected) => {
    expect(formatCount(count)).toBe(expected)
  })
})

describe('pluralize', () => {
  it('uses the singular for exactly one', () => {
    expect(pluralize(1, 'rule', 'rules')).toBe('1 rule')
  })

  it('uses the plural for zero and for many, with separators', () => {
    expect(pluralize(0, 'rule', 'rules')).toBe('0 rules')
    expect(pluralize(1143, 'control', 'controls')).toBe('1,143 controls')
  })
})
