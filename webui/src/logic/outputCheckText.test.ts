import { describe, expect, it } from 'vitest'
import { describeOutputCheck, formatCheckValue, operatorSymbol } from './outputCheckText'
import type { Operator, OutputCheck } from '../types/rule-detail'

describe('describeOutputCheck', () => {
  it('describes a benchmark-defined equality check', () => {
    const check: OutputCheck = {
      variable: 'cis_intune_win11_1_1_allow_cortana_above_lock',
      data_type: 'integer',
      operator: 'eq',
      value: 0,
      value_source: 'benchmark',
    }

    expect(describeOutputCheck(check)).toBe('cis_intune_win11_1_1_allow_cortana_above_lock equals 0')
  })

  it('describes a gte check with a numeric threshold', () => {
    const check: OutputCheck = {
      variable: 'cis_macos26_1_6_days',
      data_type: 'integer',
      operator: 'gte',
      value: 30,
      value_source: 'benchmark',
    }

    expect(describeOutputCheck(check)).toBe('cis_macos26_1_6_days is at least 30')
  })

  it('describes a boolean equality check', () => {
    const check: OutputCheck = {
      variable: 'cis_macos26_2_3_3_4_remote_login',
      data_type: 'boolean',
      operator: 'eq',
      value: false,
      value_source: 'benchmark',
    }

    expect(describeOutputCheck(check)).toBe('cis_macos26_2_3_3_4_remote_login equals false')
  })

  it('renders organization-defined values as a placeholder rather than null', () => {
    const check: OutputCheck = {
      variable: 'cis_macos26_2_1_1_1_icloud_keychain_sync_allowed',
      data_type: 'boolean',
      operator: 'eq',
      value: null,
      value_source: 'organization_defined',
    }

    expect(describeOutputCheck(check)).toBe('cis_macos26_2_1_1_1_icloud_keychain_sync_allowed equals (organization-defined value)')
  })
})

describe('operatorSymbol', () => {
  it('has a compact symbol or word for every operator in the fixed set', () => {
    const operators: Operator[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'like']

    for (const operator of operators) {
      expect(operatorSymbol(operator)).toEqual(expect.any(String))
      expect(operatorSymbol(operator).length).toBeGreaterThan(0)
    }
  })

  it('uses mathematical symbols for the comparison operators', () => {
    expect(operatorSymbol('eq')).toBe('=')
    expect(operatorSymbol('ne')).toBe('≠')
    expect(operatorSymbol('gt')).toBe('>')
    expect(operatorSymbol('gte')).toBe('≥')
    expect(operatorSymbol('lt')).toBe('<')
    expect(operatorSymbol('lte')).toBe('≤')
  })
})

describe('formatCheckValue', () => {
  it('stringifies a benchmark-defined value', () => {
    expect(formatCheckValue({ variable: 'v', data_type: 'integer', operator: 'eq', value: 30, value_source: 'benchmark' })).toBe(
      '30',
    )
  })

  it('stringifies a boolean value', () => {
    expect(formatCheckValue({ variable: 'v', data_type: 'boolean', operator: 'eq', value: true, value_source: 'benchmark' })).toBe(
      'true',
    )
  })

  it('renders a short placeholder for organization-defined values', () => {
    expect(
      formatCheckValue({ variable: 'v', data_type: 'boolean', operator: 'eq', value: null, value_source: 'organization_defined' }),
    ).toBe('org-defined')
  })
})
