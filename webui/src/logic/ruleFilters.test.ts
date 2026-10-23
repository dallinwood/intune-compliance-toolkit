import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildRuleRows } from '../data/ruleRows'
import type { Applicability, Manifest, RuleIndex } from '../types/library'
import type { RuleRow } from '../types/rule-row'
import {
  allFacetValues,
  benchmarkFacetLabel,
  benchmarkFacetValue,
  benchmarkGroupsWithSeverities,
  compareBenchmarkFacetValues,
  compareTargetGroupKeys,
  sectionGroupKey,
  sourceGroupKey,
  tagGroupKeys,
  targetGroupKeys,
  benchmarksListedUnder,
  automationOptionCounts,
  facetOptionCounts,
  facetOptions,
  matchesFilters,
  parseBenchmarkFacetValue,
  rowsInView,
  versionsListingAnyOf,
  type FilterValues,
} from './ruleFilters'
import { NO_TARGET_KEY, NO_VERSION_KEY, benchmarksAt, compareScopeKeys, compareVersionKeys, scopeKeysOf } from './applicability'
import { groupLabel, type VocabularyIndex } from './vocabulary'
import { committedVocabularyIndex, vocabularyIndexOf } from './testVocabularyFixtures'
import { applicabilityOfVersions } from './testRuleFixtures'

function row(overrides: Partial<RuleRow> = {}): RuleRow {
  return {
    ref: { id: 'mscp.os_gatekeeper_enable', path: 'mscp/rules/os_gatekeeper_enable.json' },
    title: 'Enable Gatekeeper',
    targetKeys: ['macOS'],
    section: 'os',
    sectionPath: ['os'],
    sourceName: 'mscp',
    releaseTag: 'release_27.0',
    assessment: { status: 'automated', manual_reason: null },
    architecture: null,
    applicability: applicabilityOfVersions({ 'macOS 26.0': [{ name: 'cis_lvl1', severity: null }] }),
    scopeKeys: ['macOS 26.0'],
    benchmarks: ['cis_lvl1'],
    tags: ['800-53r5_high'],
    hasOdv: false,
    ...overrides,
  }
}

function emptyFilters(overrides: Partial<FilterValues> = {}): FilterValues {
  return {
    search: '',
    targets: new Set(),
    sources: new Set(),
    versions: new Set(),
    benchmarks: new Set(),
    sections: new Set(),
    tags: new Set(),
    automatable: 'all',
    ...overrides,
  }
}

function versionOptionsUnder(rowsToFilter: RuleRow[], filters: FilterValues, index: VocabularyIndex): string[] {
  return facetOptions(
    rowsToFilter,
    filters,
    (r) => versionsListingAnyOf(r, filters.benchmarks, index),
    filters.versions,
    index,
  )
}

function benchmarkOptionsUnder(rowsToFilter: RuleRow[], filters: FilterValues, index: VocabularyIndex): string[] {
  return facetOptions(
    rowsToFilter,
    filters,
    (r) => benchmarksListedUnder(r, filters.versions, index),
    filters.benchmarks,
    index,
  )
}

// Every option the version and benchmark facets offer, alone or after the
// other facet has one pick, must match at least one row.
function expectNoZeroRowCombination(rowsToFilter: RuleRow[], index: VocabularyIndex): void {
  const matchesAny = (filters: FilterValues) => rowsToFilter.some((r) => matchesFilters(r, filters, index))
  const describeCombination = (version: string | null, benchmark: string | null) =>
    `version ${version ?? '(any)'} + benchmark ${benchmark === null ? '(any)' : JSON.stringify(parseBenchmarkFacetValue(benchmark))}`

  for (const version of versionOptionsUnder(rowsToFilter, emptyFilters(), index)) {
    const versionPicked = emptyFilters({ versions: new Set([version]) })
    expect(matchesAny(versionPicked), describeCombination(version, null)).toBe(true)
    for (const benchmark of benchmarkOptionsUnder(rowsToFilter, versionPicked, index)) {
      const both = emptyFilters({ versions: new Set([version]), benchmarks: new Set([benchmark]) })
      expect(matchesAny(both), describeCombination(version, benchmark)).toBe(true)
    }
  }
  for (const benchmark of benchmarkOptionsUnder(rowsToFilter, emptyFilters(), index)) {
    const benchmarkPicked = emptyFilters({ benchmarks: new Set([benchmark]) })
    expect(matchesAny(benchmarkPicked), describeCombination(null, benchmark)).toBe(true)
    for (const version of versionOptionsUnder(rowsToFilter, benchmarkPicked, index)) {
      const both = emptyFilters({ versions: new Set([version]), benchmarks: new Set([benchmark]) })
      expect(matchesAny(both), describeCombination(version, benchmark)).toBe(true)
    }
  }
}

const gatekeeperRow = row()
const passwordRow = row({
  ref: { id: 'mscp.pwpolicy_minimum_length_enforce', path: 'mscp/rules/pwpolicy_minimum_length_enforce.json' },
  title: 'Require a Minimum Password Length of $ODV Characters',
  section: 'pwpolicy',
  assessment: { status: 'manual', manual_reason: 'manual' },
  applicability: applicabilityOfVersions({
    'macOS 27.0': [{ name: 'disa_stig', severity: 'medium' }],
    'macOS 26.0': [{ name: 'disa_stig', severity: 'medium' }, { name: 'cis_lvl2', severity: null }],
  }),
  scopeKeys: ['macOS 27.0', 'macOS 26.0'],
  benchmarks: ['cis_lvl2', 'disa_stig'],
  tags: ['cisv8'],
  hasOdv: true,
})
const rows = [gatekeeperRow, passwordRow]
const noVocabulary = vocabularyIndexOf({})
const stigMedium = benchmarkFacetValue('disa_stig', 'medium')

describe('matchesFilters', () => {
  it('matches everything when no filters are set', () => {
    expect(matchesFilters(gatekeeperRow, emptyFilters(), noVocabulary)).toBe(true)
    expect(matchesFilters(passwordRow, emptyFilters(), noVocabulary)).toBe(true)
  })

  it('filters by OS version when the row lists at least one selected version', () => {
    const filters = emptyFilters({ versions: new Set(['macOS 27.0']) })
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
      applicability: applicabilityOfVersions({
        'macOS 27.0': [{ name: 'disa_stig', severity: null }],
        'macOS 26.0': [{ name: 'cis_lvl1', severity: null }],
      }),
      scopeKeys: ['macOS 27.0', 'macOS 26.0'],
      benchmarks: ['cis_lvl1', 'disa_stig'],
    })

    const onTwentySeven = emptyFilters({ versions: new Set(['macOS 27.0']), benchmarks: new Set(['cis_lvl1']) })
    const onTwentySix = emptyFilters({ versions: new Set(['macOS 26.0']), benchmarks: new Set(['cis_lvl1']) })

    expect(matchesFilters(cisLevelOneOnTwentySixOnly, onTwentySeven, noVocabulary)).toBe(false)
    expect(matchesFilters(cisLevelOneOnTwentySixOnly, onTwentySix, noVocabulary)).toBe(true)
  })

  it('does not scope the benchmark match by versions when versions is the excluded dimension', () => {
    const filters = emptyFilters({ versions: new Set(['macOS 27.0']), benchmarks: new Set(['cis_lvl2']) })
    expect(matchesFilters(passwordRow, filters, noVocabulary)).toBe(false)
    expect(matchesFilters(passwordRow, filters, noVocabulary, 'versions')).toBe(true)
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

  describe('an ISM row', () => {
    const ismRow = row({
      ref: { id: 'asd_ism.ism-1667', path: 'asd_ism/rules/ism-1667.json' },
      title: 'Microsoft Office is blocked from creating child processes.',
      sourceName: 'asd_ism',
    })

    it('does not match its source prefix', () => {
      expect(matchesFilters(ismRow, emptyFilters({ search: 'asd' }), noVocabulary)).toBe(false)
      expect(matchesFilters(ismRow, emptyFilters({ search: 'asd_ism.' }), noVocabulary)).toBe(false)
    })

    it('matches its control number', () => {
      expect(matchesFilters(ismRow, emptyFilters({ search: '1667' }), noVocabulary)).toBe(true)
      expect(matchesFilters(ismRow, emptyFilters({ search: 'ism-1667' }), noVocabulary)).toBe(true)
    })
  })

  it('ignores the excluded dimension', () => {
    const filters = emptyFilters({ sections: new Set(['pwpolicy']) })
    expect(matchesFilters(gatekeeperRow, filters, noVocabulary, 'sections')).toBe(true)
  })
})

describe('facetOptions', () => {
  it('offers every value present when nothing else is selected', () => {
    const options = facetOptions(rows, emptyFilters(), (r) => r.section, [], noVocabulary)
    expect(options).toEqual(['os', 'pwpolicy'])
  })

  it('narrows to only the values reachable under the other applied filters', () => {
    const filters = emptyFilters({ sections: new Set(['pwpolicy']) })
    const options = facetOptions(rows, filters, (r) => r.scopeKeys, filters.versions, noVocabulary)
    expect(options).toEqual(['macOS 26.0', 'macOS 27.0'])

    const narrower = emptyFilters({ versions: new Set(['macOS 27.0']) })
    expect(facetOptions(rows, narrower, (r) => r.section, narrower.sections, noVocabulary)).toEqual(['pwpolicy'])
  })

  it('narrows a facet by its own selection too', () => {
    const filters = emptyFilters({ sections: new Set(['pwpolicy']) })
    const options = facetOptions(rows, filters, (r) => r.section, filters.sections, noVocabulary)
    expect(options).toEqual(['pwpolicy'])
  })

  it('keeps an already-selected value visible even once no view row has it', () => {
    const filters = emptyFilters({ sections: new Set(['pwpolicy']), versions: new Set(['macOS 9.9']) })
    const options = facetOptions(rows, filters, (r) => r.scopeKeys, filters.versions, noVocabulary)
    expect(options).toEqual(['macOS 9.9'])
  })

  it('flattens array-valued facets like benchmarks', () => {
    const options = facetOptions(rows, emptyFilters(), (r) => r.benchmarks, [], noVocabulary)
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
    const versionRows = [row({ scopeKeys: ['macOS 9.0', 'macOS 27.0'] }), row({ scopeKeys: ['macOS 15.0', 'macOS 26.0'] })]
    expect(allFacetValues(versionRows, (r) => r.scopeKeys, compareVersionKeys)).toEqual([
      'macOS 27.0',
      'macOS 26.0',
      'macOS 15.0',
      'macOS 9.0',
    ])
  })
})

describe('version-scoped facets', () => {
  it('lists every benchmark when no version is selected', () => {
    expect(benchmarksListedUnder(passwordRow, new Set(), noVocabulary)).toEqual([stigMedium, 'cis_lvl2'])
  })

  it('lists only benchmarks under the selected versions', () => {
    expect(benchmarksListedUnder(passwordRow, new Set(['macOS 27.0']), noVocabulary)).toEqual([stigMedium])
  })

  it('lists every version when no benchmark is selected', () => {
    expect(versionsListingAnyOf(passwordRow, new Set(), noVocabulary)).toEqual(['macOS 27.0', 'macOS 26.0'])
  })

  it('lists only versions that list a selected benchmark', () => {
    expect(versionsListingAnyOf(passwordRow, new Set(['cis_lvl2']), noVocabulary)).toEqual(['macOS 26.0'])
  })

  it('stops the benchmark facet offering a benchmark the selected version does not list', () => {
    const filters = emptyFilters({ versions: new Set(['macOS 27.0']) })
    const options = facetOptions(
      rows,
      filters,
      (r) => benchmarksListedUnder(r, filters.versions, noVocabulary),
      filters.benchmarks,
      noVocabulary,
    )
    expect(options).toEqual([stigMedium])
  })

  it('stops the version facet offering a version the selected benchmark is not listed under', () => {
    const filters = emptyFilters({ benchmarks: new Set(['cis_lvl2']) })
    const options = facetOptions(
      rows,
      filters,
      (r) => versionsListingAnyOf(r, filters.benchmarks, noVocabulary),
      filters.versions,
      noVocabulary,
    )
    expect(options).toEqual(['macOS 26.0'])
  })
})

describe('target and source facets', () => {
  const iosRow = row({
    ref: { id: 'mscp.ios_passcode', path: 'mscp/rules/ios_passcode.json' },
    targetKeys: ['iOS'],
  })
  const otherSourceRow = row({
    ref: { id: 'cis.os_gatekeeper', path: 'cis/rules/os_gatekeeper.json' },
    sourceName: 'cis',
    section: 'pwpolicy',
  })
  const mixedRows = [gatekeeperRow, iosRow, otherSourceRow]
  const targetsOf = (rowToRead: RuleRow) => targetGroupKeys(rowToRead, noVocabulary)
  const sourceOf = (rowToRead: RuleRow) => sourceGroupKey(rowToRead, noVocabulary)

  it('offers one option per target and per source present in the data', () => {
    expect(facetOptions(mixedRows, emptyFilters(), targetsOf, [], noVocabulary)).toEqual(['iOS', 'macOS'])
    expect(facetOptions(mixedRows, emptyFilters(), sourceOf, [], noVocabulary)).toEqual(['cis', 'mscp'])
  })

  it('matches a row on any selected target or source', () => {
    const iosOnly = emptyFilters({ targets: new Set(['iOS']) })
    expect(mixedRows.map((r) => matchesFilters(r, iosOnly, noVocabulary))).toEqual([false, true, false])
    const eitherTarget = emptyFilters({ targets: new Set(['iOS', 'macOS']) })
    expect(mixedRows.map((r) => matchesFilters(r, eitherTarget, noVocabulary))).toEqual([true, true, true])
    const cisOnly = emptyFilters({ sources: new Set(['cis']) })
    expect(mixedRows.map((r) => matchesFilters(r, cisOnly, noVocabulary))).toEqual([false, false, true])
  })

  it('narrows the other facets by the selected target or source, never offering a zero-row option', () => {
    const iosOnly = emptyFilters({ targets: new Set(['iOS']) })
    expect(facetOptions(mixedRows, iosOnly, sourceOf, iosOnly.sources, noVocabulary)).toEqual(['mscp'])
    expect(facetOptions(mixedRows, iosOnly, (r) => r.section, [], noVocabulary)).toEqual(['os'])

    const cisOnly = emptyFilters({ sources: new Set(['cis']) })
    expect(facetOptions(mixedRows, cisOnly, targetsOf, cisOnly.targets, noVocabulary)).toEqual(['macOS'])
  })

  it('narrows a facet by its own selection, and keeps a selected value visible', () => {
    const iosOnly = emptyFilters({ targets: new Set(['iOS']) })
    expect(facetOptions(mixedRows, iosOnly, targetsOf, iosOnly.targets, noVocabulary)).toEqual(['iOS'])
    const unreachable = emptyFilters({ targets: new Set(['iOS']), sources: new Set(['cis']) })
    expect(facetOptions(mixedRows, unreachable, targetsOf, unreachable.targets, noVocabulary)).toEqual(['iOS'])
  })

  it('labels options through the vocabulary, falling back to the raw value', () => {
    const labelled = vocabularyIndexOf({
      targets: [{ label: 'Apple macOS', terms: ['macOS'] }],
      sources: [{ label: 'NIST mSCP', terms: ['mscp'] }],
    })
    expect(groupLabel(labelled, 'targets', targetGroupKeys(gatekeeperRow, labelled)[0])).toBe('Apple macOS')
    expect(groupLabel(labelled, 'sources', sourceGroupKey(gatekeeperRow, labelled))).toBe('NIST mSCP')
    expect(groupLabel(labelled, 'targets', targetGroupKeys(iosRow, labelled)[0])).toBe('iOS')
    expect(groupLabel(labelled, 'sources', sourceGroupKey(otherSourceRow, labelled))).toBe('cis')
  })

  it('matches grouped terms by their group key', () => {
    const grouped = vocabularyIndexOf({ sources: [{ label: 'NIST mSCP', terms: ['mscp', 'macos_security'] }] })
    const renamedSourceRow = row({ sourceName: 'macos_security' })
    expect(matchesFilters(renamedSourceRow, emptyFilters({ sources: new Set(['mscp']) }), grouped)).toBe(true)
  })
})

describe('grouped terms', () => {
  const groupedVocabulary = vocabularyIndexOf({
    benchmarks: [{ label: 'CIS Level 1', terms: ['cis_lvl1', 'cislevel1'] }],
    versions: [{ label: 'macOS 26', terms: ['macOS 26.0', 'macOS 26.1'] }],
    sections: [{ label: 'Operating system', terms: ['os', 'operating_system'] }],
    tags: [{ label: 'NIST high', terms: ['800-53r5_high', 'nist_high'] }],
  })
  const currentCodeRow = row({
    ref: { id: 'mscp.current_code', path: 'mscp/rules/current_code.json' },
    applicability: applicabilityOfVersions({ 'macOS 26.0': [{ name: 'cis_lvl1', severity: null }] }),
    scopeKeys: ['macOS 26.0'],
    benchmarks: ['cis_lvl1'],
  })
  const renamedCodeRow = row({
    ref: { id: 'mscp.renamed_code', path: 'mscp/rules/renamed_code.json' },
    section: 'operating_system',
    applicability: applicabilityOfVersions({ 'macOS 27.0': [{ name: 'cislevel1', severity: null }] }),
    scopeKeys: ['macOS 27.0'],
    benchmarks: ['cislevel1'],
    tags: ['nist_high'],
  })
  const stigOnTwentySevenRow = row({
    ref: { id: 'mscp.stig_only', path: 'mscp/rules/stig_only.json' },
    section: 'pwpolicy',
    applicability: applicabilityOfVersions({
      'macOS 27.0': [{ name: 'disa_stig', severity: null }],
      'macOS 26.1': [{ name: 'cislevel1', severity: null }],
    }),
    scopeKeys: ['macOS 27.0', 'macOS 26.1'],
    benchmarks: ['cislevel1', 'disa_stig'],
    tags: [],
  })
  const groupedRows = [currentCodeRow, renamedCodeRow, stigOnTwentySevenRow]

  it('offers one benchmark option for a group and matches rows using either code', () => {
    const options = facetOptions(
      groupedRows,
      emptyFilters(),
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
    expect(matchesFilters(stigOnTwentySevenRow, emptyFilters({ versions: new Set(['macOS 26.0']) }), groupedVocabulary)).toBe(true)
    expect(matchesFilters(renamedCodeRow, emptyFilters({ sections: new Set(['os']) }), groupedVocabulary)).toBe(true)
    expect(matchesFilters(renamedCodeRow, emptyFilters({ tags: new Set(['800-53r5_high']) }), groupedVocabulary)).toBe(true)
    expect(sectionGroupKey(renamedCodeRow, groupedVocabulary)).toBe('os')
    expect(tagGroupKeys(renamedCodeRow, groupedVocabulary)).toEqual(['800-53r5_high'])
  })

  it('scopes a grouped benchmark to the selected versions, never offering a zero-row combination', () => {
    const onTwentySeven = emptyFilters({ versions: new Set(['macOS 27.0']) })
    const benchmarkOptions = facetOptions(
      groupedRows,
      onTwentySeven,
      (r) => benchmarksListedUnder(r, onTwentySeven.versions, groupedVocabulary),
      onTwentySeven.benchmarks,
      groupedVocabulary,
    )
    expect(benchmarkOptions).toEqual(['cis_lvl1', 'disa_stig'])

    // stigOnTwentySevenRow lists the CIS group only under 26.1, so picking
    // macOS 27 + CIS must not match it.
    const bothOnTwentySeven = emptyFilters({ versions: new Set(['macOS 27.0']), benchmarks: new Set(['cis_lvl1']) })
    expect(groupedRows.map((r) => matchesFilters(r, bothOnTwentySeven, groupedVocabulary))).toEqual([false, true, false])

    const stigSelected = emptyFilters({ benchmarks: new Set(['disa_stig']) })
    const versionOptions = facetOptions(
      groupedRows,
      stigSelected,
      (r) => versionsListingAnyOf(r, stigSelected.benchmarks, groupedVocabulary),
      stigSelected.versions,
      groupedVocabulary,
    )
    expect(versionOptions).toEqual(['macOS 27.0'])

    expectNoZeroRowCombination(groupedRows, groupedVocabulary)
  })

  it('maps grouped version codes to one version option', () => {
    expect(versionsListingAnyOf(stigOnTwentySevenRow, new Set(), groupedVocabulary)).toEqual(['macOS 27.0', 'macOS 26.0'])
    expect(versionsListingAnyOf(stigOnTwentySevenRow, new Set(['cis_lvl1']), groupedVocabulary)).toEqual(['macOS 26.0'])
  })
})

describe('benchmark facet values', () => {
  it('round-trips a benchmark with and without a severity', () => {
    for (const pair of [
      { groupKey: 'disa_stig', severity: 'high' },
      { groupKey: 'disa_stig', severity: null },
      { groupKey: 'cnssi-1253 (high)', severity: 'cat i' },
    ]) {
      expect(parseBenchmarkFacetValue(benchmarkFacetValue(pair.groupKey, pair.severity))).toEqual(pair)
    }
  })

  it('keeps the no-severity value distinct from every severity value', () => {
    const values = new Set([benchmarkFacetValue('disa_stig', null), benchmarkFacetValue('disa_stig', 'high')])
    expect(values.size).toBe(2)
  })

  // benchmarkSummary already shows an empty severity as none, so the filter
  // must agree or an offered option could fail to match its own rows.
  it('treats an empty severity as no severity', () => {
    const emptySeverityRow = row({
      applicability: applicabilityOfVersions({ 'macOS 26.0': [{ name: 'disa_stig', severity: '' }] }),
      benchmarks: ['disa_stig'],
    })
    expect(benchmarksListedUnder(emptySeverityRow, new Set(), noVocabulary)).toEqual(['disa_stig'])
    expect(matchesFilters(emptySeverityRow, emptyFilters({ benchmarks: new Set(['disa_stig']) }), noVocabulary)).toBe(true)
  })
})

function applicabilityRow(id: string, applicability: Applicability): RuleRow {
  const scopeKeys = scopeKeysOf(applicability)
  const benchmarks = Array.from(new Set(scopeKeys.flatMap((key) => benchmarksAt(applicability, key).map((entry) => entry.name)))).sort()
  return row({ ref: { id: `mscp.${id}`, path: `mscp/rules/${id}.json` }, applicability, scopeKeys, benchmarks })
}

const SEVERITY_VOCABULARY = [
  { label: 'Low', terms: ['low'], metadata: ['severity'] },
  { label: 'Medium', terms: ['medium'], metadata: ['severity'] },
  { label: 'High', terms: ['high'], metadata: ['severity'] },
]

function benchmarkOptionsInOrder(rowsToList: RuleRow[], index: VocabularyIndex): string[] {
  return allFacetValues(rowsToList, (r) => benchmarksListedUnder(r, new Set(), index), compareBenchmarkFacetValues(index))
}

describe('a benchmark with severities on some entries and none on others', () => {
  const vocabulary = vocabularyIndexOf({
    benchmarks: [
      { label: 'Other baseline', terms: ['other_baseline'] },
      { label: 'Acme baseline', terms: ['acme_baseline'] },
    ],
    severities: SEVERITY_VOCABULARY,
  })
  const highOnTwoNoneOnOne = applicabilityRow('high_on_two', applicabilityOfVersions({
    'macOS 2.0': [{ name: 'acme_baseline', severity: 'high' }],
    'macOS 1.0': [{ name: 'acme_baseline', severity: null }],
  }))
  const noneOnTwo = applicabilityRow('none_on_two', applicabilityOfVersions({ 'macOS 2.0': [{ name: 'acme_baseline', severity: null }] }))
  const criticalOnOneLowOnTwo = applicabilityRow('critical_on_one', applicabilityOfVersions({
    'macOS 1.0': [{ name: 'acme_baseline', severity: 'critical' }],
    'macOS 2.0': [{ name: 'acme_baseline', severity: 'low' }],
  }))
  const otherOnTwo = applicabilityRow('other_on_two', applicabilityOfVersions({ 'macOS 2.0': [{ name: 'other_baseline', severity: null }] }))
  const mixedRows = [highOnTwoNoneOnOne, noneOnTwo, criticalOnOneLowOnTwo, otherOnTwo]
  const acme = (severity: string | null) => benchmarkFacetValue('acme_baseline', severity)
  const matchingIds = (filters: FilterValues) =>
    mixedRows.filter((r) => matchesFilters(r, filters, vocabulary)).map((r) => r.ref.id.slice('mscp.'.length))

  it('offers one option per severity in vocabulary order, unlisted ones next, then the no-severity option', () => {
    expect(benchmarkOptionsInOrder(mixedRows, vocabulary)).toEqual([
      'other_baseline',
      acme('low'),
      acme('high'),
      acme('critical'),
      acme(null),
    ])
  })

  it('matches each option only against rows listing that exact severity', () => {
    expect(matchingIds(emptyFilters({ benchmarks: new Set([acme(null)]) }))).toEqual(['high_on_two', 'none_on_two'])
    expect(matchingIds(emptyFilters({ benchmarks: new Set([acme('high')]) }))).toEqual(['high_on_two'])
    expect(matchingIds(emptyFilters({ benchmarks: new Set([acme('low')]) }))).toEqual(['critical_on_one'])
    expect(matchingIds(emptyFilters({ benchmarks: new Set([acme('critical')]) }))).toEqual(['critical_on_one'])
    expect(matchingIds(emptyFilters({ benchmarks: new Set([acme(null), acme('low')]) }))).toEqual([
      'high_on_two',
      'none_on_two',
      'critical_on_one',
    ])
  })

  it('scopes the severity to the selected versions', () => {
    expect(matchingIds(emptyFilters({ versions: new Set(['macOS 2.0']), benchmarks: new Set([acme(null)]) }))).toEqual(['none_on_two'])
    expect(matchingIds(emptyFilters({ versions: new Set(['macOS 1.0']), benchmarks: new Set([acme('high')]) }))).toEqual([])
    const onVersionOne = benchmarkOptionsUnder(mixedRows, emptyFilters({ versions: new Set(['macOS 1.0']) }), vocabulary)
    expect(new Set(onVersionOne)).toEqual(new Set([acme(null), acme('critical')]))
  })

  it('narrows the version facet to versions listing the selected severity', () => {
    expect(versionOptionsUnder(mixedRows, emptyFilters({ benchmarks: new Set([acme('high')]) }), vocabulary)).toEqual(['macOS 2.0'])
    expect(versionOptionsUnder(mixedRows, emptyFilters({ benchmarks: new Set([acme('critical')]) }), vocabulary)).toEqual(['macOS 1.0'])
    expect(versionOptionsUnder(mixedRows, emptyFilters({ benchmarks: new Set([acme(null)]) }), vocabulary)).toEqual(['macOS 1.0', 'macOS 2.0'])
  })

  it('never offers a zero-row version and benchmark combination', () => {
    expectNoZeroRowCombination(mixedRows, vocabulary)
  })

  it('labels each option with the benchmark label and the severity label, or "no severity" beside severities', () => {
    const groupsWithSeverities = benchmarkGroupsWithSeverities(benchmarkOptionsInOrder(mixedRows, vocabulary))
    expect(groupsWithSeverities).toEqual(new Set(['acme_baseline']))
    const labelOf = (value: string) => benchmarkFacetLabel(vocabulary, value, groupsWithSeverities)
    expect(labelOf(acme(null))).toBe('Acme baseline (no severity)')
    expect(labelOf(acme('high'))).toBe('Acme baseline (High)')
    expect(labelOf(acme('critical'))).toBe('Acme baseline (critical)')
    expect(labelOf('other_baseline')).toBe('Other baseline')
    expect(benchmarkFacetLabel(noVocabulary, acme('high'), groupsWithSeverities)).toBe('acme_baseline (high)')
    expect(benchmarkFacetLabel(noVocabulary, acme(null), groupsWithSeverities)).toBe('acme_baseline (no severity)')
  })
})

describe('a grouped benchmark with severities', () => {
  const vocabulary = vocabularyIndexOf({
    benchmarks: [{ label: 'CIS Level 1', terms: ['cis_lvl1', 'cislevel1'] }],
    severities: [...SEVERITY_VOCABULARY.slice(0, 2), { label: 'High', terms: ['high', 'cat_i'] }],
  })
  const highUnderCurrentCode = applicabilityRow('current_high', applicabilityOfVersions({ 'macOS 26.0': [{ name: 'cis_lvl1', severity: 'high' }] }))
  const highUnderRenamedCode = applicabilityRow('renamed_high', applicabilityOfVersions({ 'macOS 27.0': [{ name: 'cislevel1', severity: 'cat_i' }] }))
  const lowAndNone = applicabilityRow('low_and_none', applicabilityOfVersions({
    'macOS 27.0': [{ name: 'cislevel1', severity: 'low' }],
    'macOS 26.0': [{ name: 'cis_lvl1', severity: null }],
  }))
  const groupedRows = [highUnderCurrentCode, highUnderRenamedCode, lowAndNone]
  const cisLevelOne = (severity: string | null) => benchmarkFacetValue('cis_lvl1', severity)

  it('offers one option per benchmark group and severity group', () => {
    const options = benchmarkOptionsInOrder(groupedRows, vocabulary)
    expect(options).toEqual([cisLevelOne('low'), cisLevelOne('high'), cisLevelOne(null)])
    const groupsWithSeverities = benchmarkGroupsWithSeverities(options)
    expect(options.map((value) => benchmarkFacetLabel(vocabulary, value, groupsWithSeverities))).toEqual([
      'CIS Level 1 (Low)',
      'CIS Level 1 (High)',
      'CIS Level 1 (no severity)',
    ])
  })

  it('matches rows listing either code of the group with that severity', () => {
    const filters = emptyFilters({ benchmarks: new Set([cisLevelOne('high')]) })
    expect(groupedRows.map((r) => matchesFilters(r, filters, vocabulary))).toEqual([true, true, false])
    expect(versionOptionsUnder(groupedRows, filters, vocabulary)).toEqual(['macOS 26.0', 'macOS 27.0'])
    const lowFilters = emptyFilters({ benchmarks: new Set([cisLevelOne('low')]) })
    expect(versionOptionsUnder(groupedRows, lowFilters, vocabulary)).toEqual(['macOS 27.0'])
  })

  it('never offers a zero-row version and benchmark combination', () => {
    expectNoZeroRowCombination(groupedRows, vocabulary)
  })
})

describe('benchmark option order', () => {
  const vocabulary = vocabularyIndexOf({
    benchmarks: [
      { label: 'Second listed', terms: ['b_second'] },
      { label: 'First listed', terms: ['a_first'] },
    ],
    severities: SEVERITY_VOCABULARY,
  })

  it('orders benchmarks by the vocabulary, then listed severities, unlisted ones alphabetically and no severity last', () => {
    const values = [
      benchmarkFacetValue('a_first', 'zeta'),
      benchmarkFacetValue('unlisted_benchmark', null),
      benchmarkFacetValue('a_first', 'high'),
      benchmarkFacetValue('a_first', 'alpha'),
      benchmarkFacetValue('a_first', null),
      benchmarkFacetValue('a_first', 'low'),
      benchmarkFacetValue('b_second', 'medium'),
      benchmarkFacetValue('a_first', 'medium'),
    ]
    expect(values.sort(compareBenchmarkFacetValues(vocabulary)).map(parseBenchmarkFacetValue)).toEqual([
      { groupKey: 'b_second', severity: 'medium' },
      { groupKey: 'a_first', severity: 'low' },
      { groupKey: 'a_first', severity: 'medium' },
      { groupKey: 'a_first', severity: 'high' },
      { groupKey: 'a_first', severity: 'alpha' },
      { groupKey: 'a_first', severity: 'zeta' },
      { groupKey: 'a_first', severity: null },
      { groupKey: 'unlisted_benchmark', severity: null },
    ])
  })
})

function committedRuleRows(): RuleRow[] {
  const baselinesDirectory = new URL('../../../baselines/', import.meta.url)
  const readBaselinesJson = <T>(relativePath: string): T =>
    JSON.parse(readFileSync(new URL(relativePath, baselinesDirectory), 'utf8')) as T
  const manifest = readBaselinesJson<Manifest>('_manifest.json')
  return manifest.sources.flatMap((source) => buildRuleRows(source, readBaselinesJson<RuleIndex>(source.index_path)))
}

describe('committed library data', () => {
  const committedRows = committedRuleRows()
  const committedVocabulary = committedVocabularyIndex()

  it('offers one DISA STIG option per severity present, ordered by the severities vocabulary, then no severity', () => {
    const options = benchmarkOptionsInOrder(committedRows, committedVocabulary)
    const groupsWithSeverities = benchmarkGroupsWithSeverities(options)
    const labelOf = (value: string) => benchmarkFacetLabel(committedVocabulary, value, groupsWithSeverities)
    const stigOptions = options.filter((value) => parseBenchmarkFacetValue(value).groupKey === 'disa_stig')
    expect(stigOptions.map(labelOf)).toEqual([
      'DISA STIG (low)',
      'DISA STIG (medium)',
      'DISA STIG (high)',
      'DISA STIG (no severity)',
    ])
    expect(labelOf(benchmarkFacetValue('cis_lvl1', null))).toBe('CIS Level 1')
  })

  it('narrows the version facet by a severity option and the table to rows listing that severity', () => {
    const stigHigh = benchmarkFacetValue('disa_stig', 'high')
    const highOnTwentySeven = emptyFilters({ versions: new Set(['macOS 27.0']), benchmarks: new Set([stigHigh]) })
    const highRows = committedRows.filter((r) => matchesFilters(r, highOnTwentySeven, committedVocabulary))
    expect(highRows.length).toBeGreaterThan(0)
    for (const highRow of highRows) {
      expect(benchmarksAt(highRow.applicability, 'macOS 27.0')).toContainEqual({ name: 'disa_stig', severity: 'high' })
    }
    const stigHighSelected = emptyFilters({ benchmarks: new Set([stigHigh]) })
    expect(versionOptionsUnder(committedRows, stigHighSelected, committedVocabulary)).toEqual(['macOS 15.0', 'macOS 26.0', 'macOS 27.0'])
  })

  it('never offers a zero-row version and benchmark combination', () => {
    expectNoZeroRowCombination(committedRows, committedVocabulary)
  })
})

describe('two targets sharing a version string', () => {
  const sharedVersionRow = row({
    applicability: applicabilityOfVersions({
      'macOS 27.0': [{ name: 'cis_lvl1', severity: null }],
      'Windows 27.0': [{ name: 'disa_stig', severity: null }],
    }),
    targetKeys: ['macOS', 'Windows'],
    scopeKeys: ['macOS 27.0', 'Windows 27.0'],
    benchmarks: ['cis_lvl1', 'disa_stig'],
  })
  const stig = benchmarkFacetValue('disa_stig', null)

  it('offers one version option per target', () => {
    expect(versionsListingAnyOf(sharedVersionRow, new Set(), noVocabulary)).toEqual(['macOS 27.0', 'Windows 27.0'])
  })

  it('scopes each benchmark to its own target version', () => {
    const stigOnMac = emptyFilters({ versions: new Set(['macOS 27.0']), benchmarks: new Set([stig]) })
    const stigOnWindows = emptyFilters({ versions: new Set(['Windows 27.0']), benchmarks: new Set([stig]) })
    expect(matchesFilters(sharedVersionRow, stigOnMac, noVocabulary)).toBe(false)
    expect(matchesFilters(sharedVersionRow, stigOnWindows, noVocabulary)).toBe(true)
    expect(benchmarksListedUnder(sharedVersionRow, new Set(['macOS 27.0']), noVocabulary)).toEqual([benchmarkFacetValue('cis_lvl1', null)])
  })

  it('passes the no-target key through ungrouped when grouping targets', () => {
    const labelled = vocabularyIndexOf({ targets: [{ label: 'Apple macOS', terms: ['macOS'] }] })
    expect(targetGroupKeys(row({ targetKeys: [NO_TARGET_KEY, 'macOS'] }), labelled)).toEqual([NO_TARGET_KEY, 'macOS'])
  })
})

describe('Target and Version "None"', () => {
  const ismRow = row({
    ref: { id: 'ism.ism-1667', path: 'ism/rules/ism-1667.json' },
    sourceName: 'ism',
    targetKeys: [NO_TARGET_KEY],
    applicability: [
      {
        target: null,
        version: null,
        benchmarks: [
          { name: 'ism_protected', severity: null },
          { name: 'e8_ml3', severity: null },
        ],
      },
    ],
    scopeKeys: [NO_VERSION_KEY],
    benchmarks: ['e8_ml3', 'ism_protected'],
    tags: [],
  })
  const versionlessMacRow = row({
    ref: { id: 'mscp.os_gatekeeper_rearm', path: 'mscp/rules/os_gatekeeper_rearm.json' },
    applicability: [{ target: 'macOS', version: null, benchmarks: [] }],
    scopeKeys: [NO_VERSION_KEY],
    benchmarks: [],
  })
  const versionedMacRow = row({
    ref: { id: 'mscp.os_gatekeeper_enable', path: 'mscp/rules/os_gatekeeper_enable.json' },
    applicability: applicabilityOfVersions({ 'macOS 27.0': [{ name: 'cis_lvl1', severity: null }] }),
    scopeKeys: ['macOS 27.0'],
    benchmarks: ['cis_lvl1'],
  })
  const noneRows = [ismRow, versionlessMacRow, versionedMacRow]
  const matchingIds = (filters: FilterValues) =>
    noneRows.filter((candidate) => matchesFilters(candidate, filters, noVocabulary)).map((candidate) => candidate.ref.id)
  const e8Ml3 = benchmarkFacetValue('e8_ml3', null)

  it('Version "None" matches the ISM row and the version-less macOS row', () => {
    expect(matchingIds(emptyFilters({ versions: new Set([NO_VERSION_KEY]) }))).toEqual([ismRow.ref.id, versionlessMacRow.ref.id])
  })

  it('a specific version does not match the rows without a version', () => {
    expect(matchingIds(emptyFilters({ versions: new Set(['macOS 27.0']) }))).toEqual([versionedMacRow.ref.id])
  })

  it('Target "None" matches only the ISM row', () => {
    expect(matchingIds(emptyFilters({ targets: new Set([NO_TARGET_KEY]) }))).toEqual([ismRow.ref.id])
  })

  it('Target macOS does not match the ISM row', () => {
    expect(matchingIds(emptyFilters({ targets: new Set(['macOS']) }))).toEqual([versionlessMacRow.ref.id, versionedMacRow.ref.id])
  })

  it('Target macOS plus Version "None" matches only the version-less macOS row', () => {
    const filters = emptyFilters({ targets: new Set(['macOS']), versions: new Set([NO_VERSION_KEY]) })
    expect(matchingIds(filters)).toEqual([versionlessMacRow.ref.id])
  })

  it('a benchmark on the unversioned entry matches only the ISM row', () => {
    expect(matchingIds(emptyFilters({ benchmarks: new Set([e8Ml3]) }))).toEqual([ismRow.ref.id])
  })

  it('a benchmark selection keeps "None" reachable in the Version facet and drops the macOS versions', () => {
    const filters = emptyFilters({ benchmarks: new Set([e8Ml3]) })
    expect(versionOptionsUnder(noneRows, filters, noVocabulary)).toEqual([NO_VERSION_KEY])
  })

  it('Version "None" narrows the Benchmark facet to the benchmarks of the unversioned entries', () => {
    const filters = emptyFilters({ versions: new Set([NO_VERSION_KEY]) })
    expect(benchmarkOptionsUnder(noneRows, filters, noVocabulary)).toEqual([benchmarkFacetValue('e8_ml3', null), benchmarkFacetValue('ism_protected', null)])
  })

  it('offers "None" in the Target and Version facets', () => {
    const everyTarget = allFacetValues(
      noneRows,
      (candidate) => targetGroupKeys(candidate, noVocabulary),
      compareTargetGroupKeys(noVocabulary),
    )
    expect(everyTarget).toEqual(['macOS', NO_TARGET_KEY])
    expect(allFacetValues(noneRows, (candidate) => versionsListingAnyOf(candidate, new Set(), noVocabulary), compareScopeKeys)).toEqual([
      'macOS 27.0',
      NO_VERSION_KEY,
    ])
  })

  it('never offers a zero-row version and benchmark combination across unversioned rows', () => {
    expectNoZeroRowCombination(noneRows, noVocabulary)
  })

  it('does not group the "none" version through a vocabulary term', () => {
    const labelled = vocabularyIndexOf({ versions: [{ label: 'Grouped', terms: ['other', NO_VERSION_KEY] }] })
    expect(versionsListingAnyOf(ismRow, new Set(), labelled)).toEqual([NO_VERSION_KEY])
  })
})

describe('facetOptionCounts', () => {
  const macRow = (id: string, overrides: Partial<RuleRow> = {}) =>
    row({ ref: { id: `mscp.${id}`, path: `mscp/rules/${id}.json` }, title: id, ...overrides })
  const ismRow = (id: string, overrides: Partial<RuleRow> = {}) =>
    macRow(id, { sourceName: 'ism', targetKeys: [NO_TARGET_KEY], tags: [], ...overrides })
  const countsFor = (
    rows: RuleRow[],
    filters: FilterValues,
    valueOf: (candidate: RuleRow) => string | string[],
    selected: Iterable<string> = [],
  ) => facetOptionCounts(rowsInView(rows, filters, noVocabulary), valueOf, selected)
  const sourceOf = (candidate: RuleRow) => sourceGroupKey(candidate, noVocabulary)
  const targetsOf = (candidate: RuleRow) => targetGroupKeys(candidate, noVocabulary)
  const tagsOf = (candidate: RuleRow) => tagGroupKeys(candidate, noVocabulary)

  it('counts every row once per option with no filters applied', () => {
    const rows = [macRow('a'), macRow('b'), ismRow('c')]
    expect(countsFor(rows, emptyFilters(), sourceOf)).toEqual(new Map([['mscp', 2], ['ism', 1]]))
  })

  it('narrows a facet by its own selection as well as by the other facets', () => {
    const rows = [macRow('a'), macRow('b'), ismRow('c')]
    const filters = emptyFilters({ sources: new Set(['mscp']) })
    expect(countsFor(rows, filters, sourceOf, filters.sources)).toEqual(new Map([['mscp', 2]]))
    expect(countsFor(rows, filters, targetsOf)).toEqual(new Map([['macOS', 2]]))
    const ismSelected = emptyFilters({ sources: new Set(['ism']) })
    expect(countsFor(rows, ismSelected, targetsOf)).toEqual(new Map([[NO_TARGET_KEY, 1]]))
    expect(countsFor(rows, ismSelected, sourceOf, ismSelected.sources).get('mscp')).toBeUndefined()
  })

  it('offers no option beside the selected one once its count is zero', () => {
    const rows = [macRow('a'), ismRow('c')]
    const filters = emptyFilters({ sources: new Set(['ism']) })
    expect(Array.from(countsFor(rows, filters, sourceOf, filters.sources).entries())).toEqual([['ism', 1]])
    expect(facetOptions(rows, filters, sourceOf, filters.sources, noVocabulary)).toEqual(['ism'])
  })

  it('keeps a selected option offered at zero so it can be unticked', () => {
    const rows = [macRow('a'), ismRow('c')]
    const filters = emptyFilters({ targets: new Set(['macOS']), sources: new Set(['ism']) })
    expect(countsFor(rows, filters, sourceOf, filters.sources).get('ism')).toBe(0)
    expect(facetOptions(rows, filters, sourceOf, filters.sources, noVocabulary)).toEqual(['ism'])
  })

  it('counts search text as an applied filter', () => {
    const rows = [macRow('alpha'), macRow('beta'), ismRow('alpha_two')]
    const counts = countsFor(rows, emptyFilters({ search: 'alpha' }), sourceOf)
    expect(counts).toEqual(new Map([['mscp', 1], ['ism', 1]]))
  })

  it('counts a row once for an option it yields twice', () => {
    const rows = [macRow('a'), macRow('b', { tags: ['x', 'y'] })]
    const doubled = (candidate: RuleRow) => [...candidate.targetKeys, ...candidate.targetKeys]
    expect(countsFor(rows, emptyFilters(), doubled).get('macOS')).toBe(2)
    expect(countsFor(rows, emptyFilters(), tagsOf)).toEqual(new Map([['800-53r5_high', 1], ['x', 1], ['y', 1]]))
  })

  it('counts tags of the visible rules only', () => {
    const rows = [macRow('a', { tags: ['x', 'y'] }), ismRow('c', { tags: ['z'] })]
    const filters = emptyFilters({ sources: new Set(['mscp']) })
    expect(countsFor(rows, filters, tagsOf)).toEqual(new Map([['x', 1], ['y', 1]]))
  })

  it('shows a selected option that no view row has as zero', () => {
    const rows = [macRow('a')]
    const filters = emptyFilters({ sources: new Set(['ism']) })
    const counts = countsFor(rows, filters, tagsOf, ['gone'])
    expect(counts.get('gone')).toBe(0)
    expect(counts.has('800-53r5_high')).toBe(false)
  })

  it('scopes benchmark counts to the selected versions and version counts to the selected benchmarks', () => {
    const rows = [
      macRow('a', {
        applicability: applicabilityOfVersions({
          'macOS 26.0': [{ name: 'cis_lvl1', severity: null }],
          'macOS 27.0': [{ name: 'cis_lvl2', severity: null }],
        }),
        scopeKeys: ['macOS 26.0', 'macOS 27.0'],
      }),
      macRow('b', {
        applicability: applicabilityOfVersions({ 'macOS 27.0': [{ name: 'cis_lvl1', severity: null }] }),
        scopeKeys: ['macOS 27.0'],
      }),
    ]
    const onTwentySix = emptyFilters({ versions: new Set(['macOS 26.0']) })
    expect(
      countsFor(rows, onTwentySix, (candidate) => benchmarksListedUnder(candidate, onTwentySix.versions, noVocabulary), onTwentySix.benchmarks),
    ).toEqual(new Map([['cis_lvl1', 1]]))

    const lvl1 = emptyFilters({ benchmarks: new Set(['cis_lvl1']) })
    expect(countsFor(rows, lvl1, (candidate) => versionsListingAnyOf(candidate, lvl1.benchmarks, noVocabulary))).toEqual(
      new Map([['macOS 26.0', 1], ['macOS 27.0', 1]]),
    )

    const both = emptyFilters({ versions: new Set(['macOS 27.0']), benchmarks: new Set(['cis_lvl1']) })
    const benchmarkCounts = countsFor(rows, both, (candidate) => benchmarksListedUnder(candidate, both.versions, noVocabulary))
    expect(benchmarkCounts).toEqual(new Map([['cis_lvl1', 1]]))
  })
})

describe('automationOptionCounts', () => {
  it('counts rows by automation value after every other filter', () => {
    const automated = row({ title: 'auto one' })
    const manual = row({ title: 'manual one', assessment: { status: 'manual', manual_reason: 'manual' } })
    const otherSource = row({ title: 'auto two', sourceName: 'ism' })
    const rows = [automated, manual, otherSource]
    expect(automationOptionCounts(rows, emptyFilters(), noVocabulary)).toEqual({ all: 3, automatable: 2, manual: 1 })
    const manualSelected = emptyFilters({ automatable: 'manual', sources: new Set(['mscp']) })
    expect(automationOptionCounts(rows, manualSelected, noVocabulary)).toEqual({ all: 2, automatable: 1, manual: 1 })
  })
})
