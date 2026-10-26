import { describe, expect, it } from 'vitest'
import type { ManifestSource, RuleIndex } from '../types/library'
import { NO_TARGET_KEY, NO_VERSION_KEY } from '../logic/applicability'
import { applicabilityOfVersions } from '../logic/testRuleFixtures'
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
  schema_version: 5,
  source: 'mscp',
  rules: [
    {
      id: 'mscp.os_gatekeeper_enable',
      title: 'Enable Gatekeeper',
      file: 'rules/os_gatekeeper_enable.json',
      section: 'os',
      section_path: ['os'],
      assessment: { status: 'automated', manual_reason: null },
      architecture: null,
      applicability: applicabilityOfVersions({
        'macOS 9.0': [{ name: 'zeta', severity: null }],
        'macOS 26.0': [{ name: 'cis_lvl1', severity: null }, { name: 'disa_stig', severity: 'medium' }],
        'macOS 15.0': [{ name: 'cis_lvl1', severity: null }],
      }),
      tags: ['800-53r5_high'],
      has_odv: false,
    },
    {
      id: 'mscp.pwpolicy_minimum_length_enforce',
      title: 'Require a Minimum Password Length of $ODV Characters',
      file: 'rules/pwpolicy_minimum_length_enforce.json',
      section: 'pwpolicy',
      section_path: ['pwpolicy'],
      assessment: { status: 'manual', manual_reason: 'manual' },
      architecture: 'arm64',
      applicability: applicabilityOfVersions({ 'macOS 27.0': [{ name: 'cis_lvl2', severity: null }] }),
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

  it('carries the full section path from the index entry', () => {
    const [nestedRow] = buildRuleRows(SOURCE, {
      ...INDEX,
      rules: [{ ...INDEX.rules[0], section: 'Guideline', section_path: ['Guideline', 'Section', 'Topic'] }],
    })
    expect(nestedRow.sectionPath).toEqual(['Guideline', 'Section', 'Topic'])
    expect(nestedRow.section).toBe('Guideline')
  })

  it('falls back to a one-level path for an index cached from before section_path existed', () => {
    const { section_path: _omitted, ...entryWithoutPath } = INDEX.rules[0]
    const [oldRow] = buildRuleRows(SOURCE, { ...INDEX, rules: [entryWithoutPath as typeof INDEX.rules[0]] })
    expect(oldRow.sectionPath).toEqual(['os'])
  })

  it('uses just the file when the index sits at the baselines root', () => {
    const [rootRow] = buildRuleRows({ ...SOURCE, index_path: '_index.json' }, INDEX)
    expect(rootRow.ref.path).toBe('rules/os_gatekeeper_enable.json')
  })

  it('carries the target keys in entry order', () => {
    expect(rows.map((row) => row.targetKeys)).toEqual([['macOS'], ['macOS']])
  })

  it('carries source name and release tag', () => {
    expect(rows[0].sourceName).toBe('mscp')
    expect(rows[0].releaseTag).toBe('release_27.0')
  })

  it('sorts scopeKeys numerically descending', () => {
    expect(rows[0].scopeKeys).toEqual(['macOS 26.0', 'macOS 15.0', 'macOS 9.0'])
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

describe('buildRuleRows for entries without a target or version', () => {
  const unversionedIndex: RuleIndex = {
    ...INDEX,
    rules: [
      {
        ...INDEX.rules[0],
        id: 'ism.ism-1667',
        file: 'rules/ism-1667.json',
        applicability: [
          {
            target: null,
            version: null,
            benchmarks: [
              { name: 'e8_ml3', severity: null },
              { name: 'ism_protected', severity: null },
            ],
          },
        ],
      },
      { ...INDEX.rules[0], id: 'mscp.os_gatekeeper_rearm', applicability: [{ target: 'macOS', version: null, benchmarks: [] }] },
    ],
  }
  const unversionedRows = buildRuleRows(SOURCE, unversionedIndex)

  it('gives the ISM-shaped row the "none" target and scope keys and its benchmarks', () => {
    expect(unversionedRows[0]).toMatchObject({ targetKeys: [NO_TARGET_KEY], scopeKeys: [NO_VERSION_KEY], benchmarks: ['e8_ml3', 'ism_protected'] })
  })

  it('gives the version-less macOS row the "none" scope key and no benchmarks', () => {
    expect(unversionedRows[1]).toMatchObject({ targetKeys: ['macOS'], scopeKeys: [NO_VERSION_KEY], benchmarks: [] })
  })

  it('does not count the "none" scope as a covered macOS version', () => {
    expect(coveredVersionsOf(unversionedRows, 'macOS')).toEqual([])
  })
})

describe('coveredVersionsOf', () => {
  it('is the union of the bare versions of one target, sorted descending', () => {
    expect(coveredVersionsOf(buildRuleRows(SOURCE, INDEX), 'macOS')).toEqual(['27.0', '26.0', '15.0', '9.0'])
  })

  it('ignores versions of other targets', () => {
    const windowsIndex: RuleIndex = {
      ...INDEX,
      rules: [{ ...INDEX.rules[1], applicability: applicabilityOfVersions({ 'macOS 27.0': [], 'Windows 99.0': [] }) }],
    }
    const windowsRows = buildRuleRows(SOURCE, windowsIndex)
    expect(coveredVersionsOf(windowsRows, 'macOS')).toEqual(['27.0'])
    expect(coveredVersionsOf(windowsRows, 'Windows')).toEqual(['99.0'])
  })
})

describe('buildRuleRows with overlays', () => {
  it('builds rows from the overlaid index entries, with section following section_path', () => {
    const overlays = [
      {
        id: 'custom',
        targets: [{ rule: 'mscp.os_gatekeeper_enable', release: 'release_27.0' }],
        fields: { title: 'Custom title', tags: ['custom-tag'], section_path: { $replace: ['custom-section'] } },
      },
    ]

    const [gatekeeper, other] = buildRuleRows(SOURCE, INDEX, overlays)

    expect(gatekeeper.title).toBe('Custom title')
    expect(gatekeeper.tags).toEqual(['800-53r5_high', 'custom-tag'])
    expect(gatekeeper.section).toBe('custom-section')
    expect(gatekeeper.sectionPath).toEqual(['custom-section'])
    expect(other).toEqual(buildRuleRows(SOURCE, INDEX)[1])
  })

  it('turns hasOdv on when an overlay sets an odv', () => {
    const odv = { datatype: 'number', description: 'Value', validation: null, recommended: 5, by_benchmark: {} }
    const overlays = [{ id: 'odv', targets: [{ rule: 'mscp.os_gatekeeper_enable', release: 'release_27.0' }], fields: { odv: { $replace: odv } } }]

    expect(buildRuleRows(SOURCE, INDEX, overlays)[0].hasOdv).toBe(true)
  })
})
