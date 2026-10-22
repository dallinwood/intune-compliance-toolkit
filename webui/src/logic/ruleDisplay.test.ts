import { describe, expect, it } from 'vitest'
import { assessmentLabel, benchmarkSummary, upstreamRuleId } from './ruleDisplay'
import { committedVocabularyIndex, vocabularyIndexOf } from './testVocabularyFixtures'

const vocabularyIndex = committedVocabularyIndex()

describe('assessmentLabel', () => {
  it('labels an automated rule with no explanation', () => {
    expect(assessmentLabel({ status: 'automated', manual_reason: null }, vocabularyIndex)).toEqual({
      label: 'Automated',
      description: null,
    })
  })

  it('adds the vocabulary label as a suffix and its description as the tooltip for a manual rule', () => {
    expect(assessmentLabel({ status: 'manual', manual_reason: 'inherent' }, vocabularyIndex)).toEqual({
      label: 'Manual - inherent',
      description: 'Met by macOS by design (mSCP: inherent).',
    })
    expect(assessmentLabel({ status: 'manual', manual_reason: 'n_a' }, vocabularyIndex).label).toBe('Manual - n/a')
    expect(assessmentLabel({ status: 'manual', manual_reason: 'no_check' }, vocabularyIndex).label).toBe('Manual - no check')
    expect(assessmentLabel({ status: 'manual', manual_reason: 'manual' }, vocabularyIndex).label).toBe('Manual - manual')
  })

  it('shows the raw reason code, as label and tooltip, when the vocabulary does not list it', () => {
    expect(assessmentLabel({ status: 'manual', manual_reason: 'permanent' }, vocabularyIndexOf({}))).toEqual({
      label: 'Manual - permanent',
      description: 'permanent',
    })
  })

  it('labels a manual rule without a reason plainly', () => {
    expect(assessmentLabel({ status: 'manual', manual_reason: null }, vocabularyIndex)).toEqual({
      label: 'Manual',
      description: 'Must be checked manually.',
    })
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
    expect(benchmarkSummary(applicability, ['27.0', '26.0'], vocabularyIndex)).toBe('CIS Level 1, DISA STIG (high)')
  })

  it('shows the raw code for a benchmark the vocabulary does not list', () => {
    const applicability = { '27.0': [{ name: 'brand_new_benchmark', severity: null }] }
    expect(benchmarkSummary(applicability, ['27.0'], vocabularyIndex)).toBe('brand_new_benchmark')
  })

  it('is empty when no version is listed', () => {
    expect(benchmarkSummary({}, [], vocabularyIndex)).toBe('')
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
