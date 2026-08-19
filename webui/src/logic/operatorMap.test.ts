import { describe, expect, it } from 'vitest'
import { deriveComplianceVariableName, hasInScriptFallback, isSupportedOperator, mapDataType, mapOperator } from './operatorMap'

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

describe('hasInScriptFallback', () => {
  it('is true only for contains - like has no defined semantics yet', () => {
    expect(hasInScriptFallback('contains')).toBe(true)
    expect(hasInScriptFallback('like')).toBe(false)
  })

  it('is false for every natively-supported operator', () => {
    expect(hasInScriptFallback('eq')).toBe(false)
    expect(hasInScriptFallback('ne')).toBe(false)
    expect(hasInScriptFallback('gt')).toBe(false)
    expect(hasInScriptFallback('gte')).toBe(false)
    expect(hasInScriptFallback('lt')).toBe(false)
    expect(hasInScriptFallback('lte')).toBe(false)
  })
})

describe('deriveComplianceVariableName', () => {
  it('appends the generator-owned __compliant suffix', () => {
    expect(deriveComplianceVariableName('cis_intune_win11_6_7_auth_policy_change_setting')).toBe(
      'cis_intune_win11_6_7_auth_policy_change_setting__compliant',
    )
  })
})
