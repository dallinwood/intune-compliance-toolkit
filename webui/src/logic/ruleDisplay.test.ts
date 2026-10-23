import { describe, expect, it } from 'vitest'
import { NO_VERSION_KEY } from './applicability'
import { assessmentLabel, benchmarkSummary, upstreamRuleId } from './ruleDisplay'
import { applicabilityOfVersions } from './testRuleFixtures'
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
    expect(assessmentLabel({ status: 'manual', manual_reason: 'manual' }, vocabularyIndex).label).toBe('Manual - marked by mSCP')
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
  const stig = (severity: string | null) => ({ name: 'disa_stig', severity })
  const cisLevel1 = { name: 'cis_lvl1', severity: null }

  it('combines every listed version and names the versions of an item that is not on all of them', () => {
    const applicability = applicabilityOfVersions({
      'macOS 15.0': [cisLevel1, stig('medium')],
      'macOS 26.0': [cisLevel1, stig('medium')],
      'macOS 27.0': [stig('medium')],
    })
    expect(benchmarkSummary(applicability, ['macOS 27.0', 'macOS 26.0', 'macOS 15.0'], vocabularyIndex)).toBe(
      'CIS Level 1 on macOS 26, 15 · DISA STIG (medium)',
    )
  })

  it('shows only the benchmarks listed under the one version in scope, without a suffix', () => {
    const applicability = applicabilityOfVersions({ 'macOS 15.0': [cisLevel1, stig('medium')], 'macOS 27.0': [stig('medium')] })
    expect(benchmarkSummary(applicability, ['macOS 15.0'], vocabularyIndex)).toBe('CIS Level 1 · DISA STIG (medium)')
    expect(benchmarkSummary(applicability, ['macOS 27.0'], vocabularyIndex)).toBe('DISA STIG (medium)')
  })

  it('appends versions to partial items when several versions are in scope', () => {
    const applicability = applicabilityOfVersions({
      'macOS 15.0': [cisLevel1, stig('high')],
      'macOS 26.0': [{ name: 'nlmapgov_base', severity: null }],
      'macOS 27.0': [stig('high')],
    })
    expect(benchmarkSummary(applicability, ['macOS 27.0', 'macOS 15.0'], vocabularyIndex)).toBe('CIS Level 1 on macOS 15 · DISA STIG (high)')
  })

  it('keeps items that differ only by severity apart and names their versions', () => {
    const applicability = applicabilityOfVersions({ 'macOS 15.0': [stig('medium')], 'macOS 27.0': [stig('high')] })
    expect(benchmarkSummary(applicability, ['macOS 27.0', 'macOS 15.0'], vocabularyIndex)).toBe(
      'DISA STIG (medium) on macOS 15 · DISA STIG (high) on macOS 27',
    )
  })

  it('orders items by the benchmark then severity vocabulary order, no severity last', () => {
    const applicability = applicabilityOfVersions({ 'macOS 27.0': [stig(null), stig('high'), cisLevel1, stig('low')] })
    expect(benchmarkSummary(applicability, ['macOS 27.0'], vocabularyIndex)).toBe('CIS Level 1 · DISA STIG (low) · DISA STIG (high) · DISA STIG')
  })

  it('merges grouped benchmark codes into one item', () => {
    const grouped = vocabularyIndexOf({ benchmarks: [{ label: 'Renamed', terms: ['old_code', 'new_code'] }] })
    const applicability = applicabilityOfVersions({ 'macOS 15.0': [{ name: 'old_code', severity: null }], 'macOS 27.0': [{ name: 'new_code', severity: null }] })
    expect(benchmarkSummary(applicability, ['macOS 27.0', 'macOS 15.0'], grouped)).toBe('Renamed')
  })

  it('shows the severity by its severities vocabulary label', () => {
    const relabelled = vocabularyIndexOf({
      benchmarks: [{ label: 'DISA STIG', terms: ['disa_stig'] }],
      severities: [{ label: 'CAT I', terms: ['high'] }],
    })
    const applicability = applicabilityOfVersions({ 'macOS 27.0': [stig('high'), stig('unlisted')] })
    expect(benchmarkSummary(applicability, ['macOS 27.0'], relabelled)).toBe('DISA STIG (CAT I) · DISA STIG (unlisted)')
  })

  it('shows the raw code for a benchmark the vocabulary does not list', () => {
    const applicability = applicabilityOfVersions({ 'macOS 27.0': [{ name: 'brand_new_benchmark', severity: null }] })
    expect(benchmarkSummary(applicability, ['macOS 27.0'], vocabularyIndex)).toBe('brand_new_benchmark')
  })

  it('falls back to the raw version for a version the vocabulary does not list', () => {
    const applicability = applicabilityOfVersions({ 'macOS 99.0': [cisLevel1], 'macOS 27.0': [stig(null)] })
    expect(benchmarkSummary(applicability, ['macOS 99.0', 'macOS 27.0'], vocabularyIndex)).toBe('CIS Level 1 on macOS 99.0 · DISA STIG on macOS 27')
  })

  it('lists the benchmarks of an unversioned ISM entry in vocabulary order', () => {
    const ismApplicability = [
      {
        target: null,
        version: null,
        benchmarks: [
          { name: 'e8_ml3', severity: null },
          { name: 'ism_protected', severity: null },
          { name: 'ism_non_classified', severity: null },
          { name: 'e8_ml1', severity: null },
        ],
      },
    ]
    expect(benchmarkSummary(ismApplicability, [NO_VERSION_KEY], vocabularyIndex)).toBe(
      'ISM Non-classified · ISM PROTECTED · Essential Eight ML1 · Essential Eight ML3',
    )
  })

  it('labels the unversioned scope None when it is named beside versions', () => {
    const applicability = [
      { target: 'macOS', version: '27.0', benchmarks: [cisLevel1] },
      { target: 'macOS', version: null, benchmarks: [stig('high')] },
    ]
    expect(benchmarkSummary(applicability, ['macOS 27.0', NO_VERSION_KEY], vocabularyIndex)).toBe(
      'CIS Level 1 on macOS 27 · DISA STIG (high) on None',
    )
  })

  it('is empty when nothing is listed under the versions in scope', () => {
    expect(benchmarkSummary([], [], vocabularyIndex)).toBe('')
    expect(benchmarkSummary(applicabilityOfVersions({ 'macOS 27.0': [stig(null)] }), ['macOS 15.0'], vocabularyIndex)).toBe('')
  })
})

describe('upstreamRuleId', () => {
  it('strips the source prefix from a Rule id', () => {
    expect(upstreamRuleId('mscp.os_mfa_network_non-priv')).toBe('os_mfa_network_non-priv')
  })

  it('leaves an id without a prefix unchanged', () => {
    expect(upstreamRuleId('os_gatekeeper_enable')).toBe('os_gatekeeper_enable')
  })
})
