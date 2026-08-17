import { describe, expect, it } from 'vitest'
import { isSupportedOperator, mapDataType, mapOperator } from './operatorMap'

describe('isSupportedOperator', () => {
  it('is true for every comparison operator Intune natively supports', () => {
    expect(isSupportedOperator('eq')).toBe(true)
    expect(isSupportedOperator('ne')).toBe(true)
    expect(isSupportedOperator('gt')).toBe(true)
    expect(isSupportedOperator('gte')).toBe(true)
    expect(isSupportedOperator('lt')).toBe(true)
    expect(isSupportedOperator('lte')).toBe(true)
  })

  it('is false for operators Intune has no native equivalent for', () => {
    expect(isSupportedOperator('contains')).toBe(false)
    expect(isSupportedOperator('like')).toBe(false)
  })
})

describe('mapOperator', () => {
  it('maps every comparison operator to its Intune equivalent', () => {
    expect(mapOperator('eq')).toBe('IsEquals')
    expect(mapOperator('ne')).toBe('NotEquals')
    expect(mapOperator('gt')).toBe('GreaterThan')
    expect(mapOperator('gte')).toBe('GreaterEquals')
    expect(mapOperator('lt')).toBe('LessThan')
    expect(mapOperator('lte')).toBe('LessEquals')
  })

  it('throws for an operator with no native Intune equivalent', () => {
    expect(() => mapOperator('contains')).toThrow()
    expect(() => mapOperator('like')).toThrow()
  })
})

describe('mapDataType', () => {
  it('maps every source data_type to its Intune equivalent', () => {
    expect(mapDataType('boolean')).toBe('Boolean')
    expect(mapDataType('integer')).toBe('Int64')
    expect(mapDataType('string')).toBe('String')
  })
})
