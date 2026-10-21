import { describe, expect, it } from 'vitest'
import { assessmentLabel, benchmarkSummary, compareSections, sectionLabel, upstreamRuleId } from './ruleDisplay'

describe('compareSections', () => {
  it('puts the known sections in mSCP order, then any others alphabetically', () => {
    const sections = ['zeta', 'supplemental', 'audit', 'alpha', 'os', 'icloud', 'auth', 'pwpolicy', 'system_settings']
    expect([...sections].sort(compareSections)).toEqual([
      'os',
      'system_settings',
      'pwpolicy',
      'auth',
      'audit',
      'icloud',
      'supplemental',
      'alpha',
      'zeta',
    ])
  })
})

describe('sectionLabel', () => {
  it('names the known sections and passes others through', () => {
    expect(sectionLabel('system_settings')).toBe('System Settings')
    expect(sectionLabel('pwpolicy')).toBe('Password policy')
    expect(sectionLabel('something_new')).toBe('something_new')
  })
})

describe('assessmentLabel', () => {
  it('labels an automated rule with no explanation', () => {
    expect(assessmentLabel({ status: 'automated', manual_reason: null })).toEqual({ label: 'Automated', description: null })
  })

  it('adds a short reason suffix and a tooltip explanation for a manual rule', () => {
    const inherent = assessmentLabel({ status: 'manual', manual_reason: 'inherent' })
    expect(inherent.label).toBe('Manual - inherent')
    expect(inherent.description).toMatch(/inherent/i)
    expect(assessmentLabel({ status: 'manual', manual_reason: 'n_a' }).label).toBe('Manual - n/a')
    expect(assessmentLabel({ status: 'manual', manual_reason: 'no_check' }).label).toBe('Manual - no check')
  })

  it('labels a plain manual rule without a redundant suffix', () => {
    expect(assessmentLabel({ status: 'manual', manual_reason: 'manual' }).label).toBe('Manual')
    expect(assessmentLabel({ status: 'manual', manual_reason: null }).label).toBe('Manual')
  })
})

describe('benchmarkSummary', () => {
  it('lists the benchmarks of the newest version, with STIG severity in parentheses', () => {
    const applicability = {
      '26.0': [{ name: 'nlmapgov_base', severity: null }],
      '27.0': [
        { name: 'cis_lvl1', severity: null },
        { name: 'disa_stig', severity: 'high' },
      ],
    }
    expect(benchmarkSummary(applicability, ['27.0', '26.0'])).toBe('CIS Level 1, DISA STIG (high)')
  })

  it('is empty when no version is listed', () => {
    expect(benchmarkSummary({}, [])).toBe('')
  })
})

describe('upstreamRuleId', () => {
  it('strips the source prefix from a v3 id', () => {
    expect(upstreamRuleId('mscp.os_mfa_network_non-priv')).toBe('os_mfa_network_non-priv')
  })

  it('leaves an id without a prefix unchanged', () => {
    expect(upstreamRuleId('os_gatekeeper_enable')).toBe('os_gatekeeper_enable')
  })
})
