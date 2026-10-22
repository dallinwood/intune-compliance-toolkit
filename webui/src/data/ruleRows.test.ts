import { describe, expect, it } from 'vitest'
import type { ManifestSource, RuleIndex } from '../types/library'
import { buildRuleRows, coveredVersionsOf } from './ruleRows'

const SOURCE: ManifestSource = {
  name: 'mscp',
  display_name: 'NIST macOS Security Compliance Project',
  release_tag: 'release_27.0',
  commit_sha: 'c'.repeat(40),
  retrieved_date: '2026-10-20',
  repository_url: 'https://github.com/usnistgov/macos_security',
  license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', rights_holder: 'NIST', modified: true },
  index_path: 'mscp/_index.json',
  rule_count: 2,
}

const INDEX: RuleIndex = {
  schema_version: 3,
  source: 'mscp',
  rules: [
    {
      id: 'mscp.os_gatekeeper_enable',
      title: 'Enable Gatekeeper',
      file: 'rules/os_gatekeeper_enable.json',
      platform: 'macOS',
      section: 'os',
      assessment: { status: 'automated', manual_reason: null },
      architecture: null,
      applicability: {
        '9.0': [{ name: 'zeta', severity: null }],
        '26.0': [{ name: 'cis_lvl1', severity: null }, { name: 'disa_stig', severity: 'medium' }],
        '15.0': [{ name: 'cis_lvl1', severity: null }],
      },
      tags: ['800-53r5_high'],
      has_odv: false,
    },
    {
      id: 'mscp.pwpolicy_minimum_length_enforce',
      title: 'Require a Minimum Password Length of $ODV Characters',
      file: 'rules/pwpolicy_minimum_length_enforce.json',
      platform: 'macOS',
      section: 'pwpolicy',
      assessment: { status: 'manual', manual_reason: 'manual' },
      architecture: 'arm64',
      applicability: { '27.0': [{ name: 'cis_lvl2', severity: null }] },
      tags: [],
      has_odv: true,
    },
  ],
}

describe('buildRuleRows', () => {
  const rows = buildRuleRows(SOURCE, INDEX)

  it('joins the index directory with the entry file to build the ref path', () => {
    expect(rows[0].ref).toEqual({ id: 'mscp.os_gatekeeper_enable', path: 'mscp/rules/os_gatekeeper_enable.json' })
  })

  it('uses just the file when the index sits at the baselines root', () => {
    const [rootRow] = buildRuleRows({ ...SOURCE, index_path: '_index.json' }, INDEX)
    expect(rootRow.ref.path).toBe('rules/os_gatekeeper_enable.json')
  })

  it('carries the platform', () => {
    expect(rows.map((row) => row.platform)).toEqual(['macOS', 'macOS'])
  })

  it('carries source name and release tag', () => {
    expect(rows[0].sourceName).toBe('mscp')
    expect(rows[0].releaseTag).toBe('release_27.0')
  })

  it('sorts osVersions numerically descending', () => {
    expect(rows[0].osVersions).toEqual(['26.0', '15.0', '9.0'])
  })

  it('builds benchmarks as the sorted union over all versions', () => {
    expect(rows[0].benchmarks).toEqual(['cis_lvl1', 'disa_stig', 'zeta'])
  })

  it('maps the remaining index fields', () => {
    expect(rows[1]).toMatchObject({
      title: 'Require a Minimum Password Length of $ODV Characters',
      section: 'pwpolicy',
      assessment: { status: 'manual', manual_reason: 'manual' },
      architecture: 'arm64',
      hasOdv: true,
    })
  })
})

describe('coveredVersionsOf', () => {
  it('is the union of all rows osVersions sorted descending', () => {
    expect(coveredVersionsOf(buildRuleRows(SOURCE, INDEX))).toEqual(['27.0', '26.0', '15.0', '9.0'])
  })
})
