import { describe, expect, it } from 'vitest'
import type { RuleRow } from '../types/rule-row'
import {
  allFacetValues,
  sectionGroupKey,
  tagGroupKeys,
  benchmarksListedUnder,
  facetOptions,
  matchesFilters,
  versionsListingAnyOf,
  type FilterValues,
} from './ruleFilters'
import { vocabularyIndexOf } from './testVocabularyFixtures'
import { compareVersionsDescending } from './versions'

function row(overrides: Partial<RuleRow> = {}): RuleRow {
  return {
    ref: { id: 'mscp.os_gatekeeper_enable', path: 'mscp/rules/os_gatekeeper_enable.json' },
    title: 'Enable Gatekeeper',
    section: 'os',
    sourceName: 'mscp',
    releaseTag: 'release_27.0',
    assessment: { status: 'automated', manual_reason: null },
    architecture: null,
    applicability: { '26.0': [{ name: 'cis_lvl1', severity: null }] },
    osVersions: ['26.0'],
    benchmarks: ['cis_lvl1'],
    tags: ['800-53r5_high'],
    hasOdv: false,
    ...overrides,
  }
}

function emptyFilters(overrides: Partial<FilterValues> = {}): FilterValues {
  return {
    search: '',
    osVersions: new Set(),
    benchmarks: new Set(),
    sections: new Set(),
    tags: new Set(),
    automatable: 'all',
    ...overrides,
  }
}

const gatekeeperRow = row()
const passwordRow = row({
  ref: { id: 'mscp.pwpolicy_minimum_length_enforce', path: 'mscp/rules/pwpolicy_minimum_length_enforce.json' },
  title: 'Require a Minimum Password Length of $ODV Characters',
  section: 'pwpolicy',
  assessment: { status: 'manual', manual_reason: 'manual' },
  applicability: {
    '27.0': [{ name: 'disa_stig', severity: 'medium' }],
    '26.0': [{ name: 'disa_stig', severity: 'medium' }, { name: 'cis_lvl2', severity: null }],
  },
  osVersions: ['27.0', '26.0'],
  benchmarks: ['cis_lvl2', 'disa_stig'],
  tags: ['cisv8'],
  hasOdv: true,
})
const rows = [gatekeeperRow, passwordRow]
const noVocabulary = vocabularyIndexOf({})

describe('matchesFilters', () => {
  it('matches everything when no filters are set', () => {
    expect(matchesFilters(gatekeeperRow, emptyFilters(), noVocabulary)).toBe(true)
    expect(matchesFilters(passwordRow, emptyFilters(), noVocabulary)).toBe(true)
  })

  it('filters by OS version when the row lists at least one selected version', () => {
    const filters = emptyFilters({ osVersions: new Set(['27.0']) })
    expect(matchesFilters(gatekeeperRow, filters, noVocabulary)).toBe(false)
    expect(matchesFilters(passwordRow, filters, noVocabulary)).toBe(true)
  })

  it('filters by section', () => {
    const filters = emptyFilters({ sections: new Set(['pwpolicy']) })
    expect(matchesFilters(gatekeeperRow, filters, noVocabulary)).toBe(false)
    expect(matchesFilters(passwordRow, filters, noVocabulary)).toBe(true)
  })

  it('filters by tag using any match', () => {
    const filters = emptyFilters({ tags: new Set(['cisv8', 'unrelated']) })
    expect(matchesFilters(gatekeeperRow, filters, noVocabulary)).toBe(false)
    expect(matchesFilters(passwordRow, filters, noVocabulary)).toBe(true)
  })

  it('filters by assessment status', () => {
    expect(matchesFilters(gatekeeperRow, emptyFilters({ automatable: 'automatable' }), noVocabulary)).toBe(true)
    expect(matchesFilters(passwordRow, emptyFilters({ automatable: 'automatable' }), noVocabulary)).toBe(false)
    expect(matchesFilters(gatekeeperRow, emptyFilters({ automatable: 'manual' }), noVocabulary)).toBe(false)
    expect(matchesFilters(passwordRow, emptyFilters({ automatable: 'manual' }), noVocabulary)).toBe(true)
  })

  it('matches a benchmark on any version when no versions are selected', () => {
    const filters = emptyFilters({ benchmarks: new Set(['cis_lvl1']) })
    expect(matchesFilters(gatekeeperRow, filters, noVocabulary)).toBe(true)
    expect(matchesFilters(passwordRow, filters, noVocabulary)).toBe(false)
  })

  it('scopes a benchmark to the selected versions', () => {
    const cisLevelOneOnTwentySixOnly = row({
      applicability: {
        '27.0': [{ name: 'disa_stig', severity: null }],
        '26.0': [{ name: 'cis_lvl1', severity: null }],
      },
      osVersions: ['27.0', '26.0'],
      benchmarks: ['cis_lvl1', 'disa_stig'],
    })

    const onTwentySeven = emptyFilters({ osVersions: new Set(['27.0']), benchmarks: new Set(['cis_lvl1']) })
    const onTwentySix = emptyFilters({ osVersions: new Set(['26.0']), benchmarks: new Set(['cis_lvl1']) })

    expect(matchesFilters(cisLevelOneOnTwentySixOnly, onTwentySeven, noVocabulary)).toBe(false)
    expect(matchesFilters(cisLevelOneOnTwentySixOnly, onTwentySix, noVocabulary)).toBe(true)
  })

  it('does not scope the benchmark match by versions when osVersions is the excluded dimension', () => {
    const filters = emptyFilters({ osVersions: new Set(['27.0']), benchmarks: new Set(['cis_lvl2']) })
    expect(matchesFilters(passwordRow, filters, noVocabulary)).toBe(false)
    expect(matchesFilters(passwordRow, filters, noVocabulary, 'osVersions')).toBe(true)
  })

  it('searches the title case-insensitively', () => {
    expect(matchesFilters(passwordRow, emptyFilters({ search: 'MINIMUM PASSWORD' }), noVocabulary)).toBe(true)
    expect(matchesFilters(gatekeeperRow, emptyFilters({ search: 'MINIMUM PASSWORD' }), noVocabulary)).toBe(false)
  })

  it('searches by upstream id without the mscp. prefix', () => {
    expect(matchesFilters(passwordRow, emptyFilters({ search: 'pwpolicy_minimum' }), noVocabulary)).toBe(true)
    expect(matchesFilters(passwordRow, emptyFilters({ search: 'PWPOLICY_MINIMUM' }), noVocabulary)).toBe(true)
    expect(matchesFilters(gatekeeperRow, emptyFilters({ search: 'pwpolicy_minimum' }), noVocabulary)).toBe(false)
  })

  it('does not match the mscp. prefix itself', () => {
    expect(matchesFilters(passwordRow, emptyFilters({ search: 'mscp.' }), noVocabulary)).toBe(false)
  })

  it('ignores the excluded dimension', () => {
    const filters = emptyFilters({ sections: new Set(['pwpolicy']) })
    expect(matchesFilters(gatekeeperRow, filters, noVocabulary, 'sections')).toBe(true)
  })
})

describe('facetOptions', () => {
  it('offers every value present when nothing else is selected', () => {
    const options = facetOptions(rows, emptyFilters(), 'sections', (r) => r.section, [], noVocabulary)
    expect(options).toEqual(['os', 'pwpolicy'])
  })

  it('narrows to only the values reachable under the other applied filters', () => {
    const filters = emptyFilters({ sections: new Set(['pwpolicy']) })
    const options = facetOptions(rows, filters, 'osVersions', (r) => r.osVersions, filters.osVersions, noVocabulary)
    expect(options).toEqual(['26.0', '27.0'])

    const narrower = emptyFilters({ osVersions: new Set(['27.0']) })
    expect(facetOptions(rows, narrower, 'sections', (r) => r.section, narrower.sections, noVocabulary)).toEqual(['pwpolicy'])
  })

  it('does not narrow a facet by its own selection', () => {
    const filters = emptyFilters({ sections: new Set(['pwpolicy']) })
    const options = facetOptions(rows, filters, 'sections', (r) => r.section, filters.sections, noVocabulary)
    expect(options).toEqual(['os', 'pwpolicy'])
  })

  it('keeps an already-selected value visible even once it becomes unreachable', () => {
    const filters = emptyFilters({ sections: new Set(['pwpolicy']), osVersions: new Set(['9.9']) })
    const options = facetOptions(rows, filters, 'osVersions', (r) => r.osVersions, filters.osVersions, noVocabulary)
    expect(options).toEqual(['26.0', '27.0', '9.9'])
  })

  it('flattens array-valued facets like benchmarks', () => {
    const options = facetOptions(rows, emptyFilters(), 'benchmarks', (r) => r.benchmarks, [], noVocabulary)
    expect(options).toEqual(['cis_lvl1', 'cis_lvl2', 'disa_stig'])
  })
})

describe('allFacetValues', () => {
  it('lists every distinct value regardless of any filter', () => {
    expect(allFacetValues(rows, (r) => r.section)).toEqual(['os', 'pwpolicy'])
  })

  it('flattens array-valued facets', () => {
    expect(allFacetValues(rows, (r) => r.benchmarks)).toEqual(['cis_lvl1', 'cis_lvl2', 'disa_stig'])
  })

  it('sorts with a supplied comparator, e.g. versions newest first by number', () => {
    const versionRows = [row({ osVersions: ['9.0', '27.0'] }), row({ osVersions: ['15.0', '26.0'] })]
    expect(allFacetValues(versionRows, (r) => r.osVersions, compareVersionsDescending)).toEqual([
      '27.0',
      '26.0',
      '15.0',
      '9.0',
    ])
  })
})

describe('version-scoped facets', () => {
  it('lists every benchmark when no version is selected', () => {
    expect(benchmarksListedUnder(passwordRow, new Set(), noVocabulary)).toEqual(['disa_stig', 'cis_lvl2'])
  })

  it('lists only benchmarks under the selected versions', () => {
    expect(benchmarksListedUnder(passwordRow, new Set(['27.0']), noVocabulary)).toEqual(['disa_stig'])
  })

  it('lists every version when no benchmark is selected', () => {
    expect(versionsListingAnyOf(passwordRow, new Set(), noVocabulary)).toEqual(['27.0', '26.0'])
  })

  it('lists only versions that list a selected benchmark', () => {
    expect(versionsListingAnyOf(passwordRow, new Set(['cis_lvl2']), noVocabulary)).toEqual(['26.0'])
  })

  it('stops the benchmark facet offering a benchmark the selected version does not list', () => {
    const filters = emptyFilters({ osVersions: new Set(['27.0']) })
    const options = facetOptions(
      rows,
      filters,
      'benchmarks',
      (r) => benchmarksListedUnder(r, filters.osVersions, noVocabulary),
      filters.benchmarks,
      noVocabulary,
    )
    expect(options).toEqual(['disa_stig'])
  })

  it('stops the version facet offering a version the selected benchmark is not listed under', () => {
    const filters = emptyFilters({ benchmarks: new Set(['cis_lvl2']) })
    const options = facetOptions(
      rows,
      filters,
      'osVersions',
      (r) => versionsListingAnyOf(r, filters.benchmarks, noVocabulary),
      filters.osVersions,
      noVocabulary,
    )
    expect(options).toEqual(['26.0'])
  })
})

describe('grouped terms', () => {
  const groupedVocabulary = vocabularyIndexOf({
    benchmarks: [{ label: 'CIS Level 1', terms: ['cis_lvl1', 'cislevel1'] }],
    os_versions: [{ label: 'macOS 26', terms: ['26.0', '26.1'] }],
    sections: [{ label: 'Operating system', terms: ['os', 'operating_system'] }],
    tags: [{ label: 'NIST high', terms: ['800-53r5_high', 'nist_high'] }],
  })
  const currentCodeRow = row({
    ref: { id: 'mscp.current_code', path: 'mscp/rules/current_code.json' },
    applicability: { '26.0': [{ name: 'cis_lvl1', severity: null }] },
    osVersions: ['26.0'],
    benchmarks: ['cis_lvl1'],
  })
  const renamedCodeRow = row({
    ref: { id: 'mscp.renamed_code', path: 'mscp/rules/renamed_code.json' },
    section: 'operating_system',
    applicability: { '27.0': [{ name: 'cislevel1', severity: null }] },
    osVersions: ['27.0'],
    benchmarks: ['cislevel1'],
    tags: ['nist_high'],
  })
  const stigOnTwentySevenRow = row({
    ref: { id: 'mscp.stig_only', path: 'mscp/rules/stig_only.json' },
    section: 'pwpolicy',
    applicability: { '27.0': [{ name: 'disa_stig', severity: null }], '26.1': [{ name: 'cislevel1', severity: null }] },
    osVersions: ['27.0', '26.1'],
    benchmarks: ['cislevel1', 'disa_stig'],
    tags: [],
  })
  const groupedRows = [currentCodeRow, renamedCodeRow, stigOnTwentySevenRow]

  it('offers one benchmark option for a group and matches rows using either code', () => {
    const options = facetOptions(
      groupedRows,
      emptyFilters(),
      'benchmarks',
      (r) => benchmarksListedUnder(r, new Set(), groupedVocabulary),
      [],
      groupedVocabulary,
    )
    expect(options).toEqual(['cis_lvl1', 'disa_stig'])

    const filters = emptyFilters({ benchmarks: new Set(['cis_lvl1']) })
    expect(groupedRows.map((r) => matchesFilters(r, filters, groupedVocabulary))).toEqual([true, true, true])
    const stigFilters = emptyFilters({ benchmarks: new Set(['disa_stig']) })
    expect(groupedRows.map((r) => matchesFilters(r, stigFilters, groupedVocabulary))).toEqual([false, false, true])
  })

  it('matches grouped versions, sections and tags by their group key', () => {
    expect(matchesFilters(stigOnTwentySevenRow, emptyFilters({ osVersions: new Set(['26.0']) }), groupedVocabulary)).toBe(true)
    expect(matchesFilters(renamedCodeRow, emptyFilters({ sections: new Set(['os']) }), groupedVocabulary)).toBe(true)
    expect(matchesFilters(renamedCodeRow, emptyFilters({ tags: new Set(['800-53r5_high']) }), groupedVocabulary)).toBe(true)
    expect(sectionGroupKey(renamedCodeRow, groupedVocabulary)).toBe('os')
    expect(tagGroupKeys(renamedCodeRow, groupedVocabulary)).toEqual(['800-53r5_high'])
  })

  it('scopes a grouped benchmark to the selected versions, never offering a zero-row combination', () => {
    const onTwentySeven = emptyFilters({ osVersions: new Set(['27.0']) })
    const benchmarkOptions = facetOptions(
      groupedRows,
      onTwentySeven,
      'benchmarks',
      (r) => benchmarksListedUnder(r, onTwentySeven.osVersions, groupedVocabulary),
      onTwentySeven.benchmarks,
      groupedVocabulary,
    )
    expect(benchmarkOptions).toEqual(['cis_lvl1', 'disa_stig'])

    // stigOnTwentySevenRow lists the CIS group only under 26.1, so picking
    // macOS 27 + CIS must not match it.
    const bothOnTwentySeven = emptyFilters({ osVersions: new Set(['27.0']), benchmarks: new Set(['cis_lvl1']) })
    expect(groupedRows.map((r) => matchesFilters(r, bothOnTwentySeven, groupedVocabulary))).toEqual([false, true, false])

    const stigSelected = emptyFilters({ benchmarks: new Set(['disa_stig']) })
    const versionOptions = facetOptions(
      groupedRows,
      stigSelected,
      'osVersions',
      (r) => versionsListingAnyOf(r, stigSelected.benchmarks, groupedVocabulary),
      stigSelected.osVersions,
      groupedVocabulary,
    )
    expect(versionOptions).toEqual(['27.0'])

    for (const version of versionOptions) {
      for (const benchmark of benchmarkOptions) {
        const combination = emptyFilters({ osVersions: new Set([version]), benchmarks: new Set([benchmark]) })
        expect(groupedRows.some((r) => matchesFilters(r, combination, groupedVocabulary))).toBe(true)
      }
    }
  })

  it('maps grouped version codes to one version option', () => {
    expect(versionsListingAnyOf(stigOnTwentySevenRow, new Set(), groupedVocabulary)).toEqual(['27.0', '26.0'])
    expect(versionsListingAnyOf(stigOnTwentySevenRow, new Set(['cis_lvl1']), groupedVocabulary)).toEqual(['26.0'])
  })
})
