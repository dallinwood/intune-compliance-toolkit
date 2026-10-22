import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildRuleRows } from '../data/ruleRows'
import type { Applicability, Manifest, RuleIndex } from '../types/library'
import type { RuleRow } from '../types/rule-row'
import {
  allFacetValues,
  benchmarkFacetLabel,
  benchmarkFacetValue,
  compareBenchmarkFacetValues,
  sectionGroupKey,
  tagGroupKeys,
  benchmarksListedUnder,
  facetOptions,
  matchesFilters,
  parseBenchmarkFacetValue,
  versionsListingAnyOf,
  type FilterValues,
} from './ruleFilters'
import type { VocabularyIndex } from './vocabulary'
import { committedVocabularyIndex, vocabularyIndexOf } from './testVocabularyFixtures'
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

function versionOptionsUnder(rowsToFilter: RuleRow[], filters: FilterValues, index: VocabularyIndex): string[] {
  return facetOptions(
    rowsToFilter,
    filters,
    'osVersions',
    (r) => versionsListingAnyOf(r, filters.benchmarks, index),
    filters.osVersions,
    index,
  )
}

function benchmarkOptionsUnder(rowsToFilter: RuleRow[], filters: FilterValues, index: VocabularyIndex): string[] {
  return facetOptions(
    rowsToFilter,
    filters,
    'benchmarks',
    (r) => benchmarksListedUnder(r, filters.osVersions, index),
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
    const versionPicked = emptyFilters({ osVersions: new Set([version]) })
    expect(matchesAny(versionPicked), describeCombination(version, null)).toBe(true)
    for (const benchmark of benchmarkOptionsUnder(rowsToFilter, versionPicked, index)) {
      const both = emptyFilters({ osVersions: new Set([version]), benchmarks: new Set([benchmark]) })
      expect(matchesAny(both), describeCombination(version, benchmark)).toBe(true)
    }
  }
  for (const benchmark of benchmarkOptionsUnder(rowsToFilter, emptyFilters(), index)) {
    const benchmarkPicked = emptyFilters({ benchmarks: new Set([benchmark]) })
    expect(matchesAny(benchmarkPicked), describeCombination(null, benchmark)).toBe(true)
    for (const version of versionOptionsUnder(rowsToFilter, benchmarkPicked, index)) {
      const both = emptyFilters({ osVersions: new Set([version]), benchmarks: new Set([benchmark]) })
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
const stigMedium = benchmarkFacetValue('disa_stig', 'medium')

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
    expect(benchmarksListedUnder(passwordRow, new Set(), noVocabulary)).toEqual([stigMedium, 'cis_lvl2'])
  })

  it('lists only benchmarks under the selected versions', () => {
    expect(benchmarksListedUnder(passwordRow, new Set(['27.0']), noVocabulary)).toEqual([stigMedium])
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
    expect(options).toEqual([stigMedium])
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

    expectNoZeroRowCombination(groupedRows, groupedVocabulary)
  })

  it('maps grouped version codes to one version option', () => {
    expect(versionsListingAnyOf(stigOnTwentySevenRow, new Set(), groupedVocabulary)).toEqual(['27.0', '26.0'])
    expect(versionsListingAnyOf(stigOnTwentySevenRow, new Set(['cis_lvl1']), groupedVocabulary)).toEqual(['26.0'])
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
    const emptySeverityRow = row({ applicability: { '26.0': [{ name: 'disa_stig', severity: '' }] }, benchmarks: ['disa_stig'] })
    expect(benchmarksListedUnder(emptySeverityRow, new Set(), noVocabulary)).toEqual(['disa_stig'])
    expect(matchesFilters(emptySeverityRow, emptyFilters({ benchmarks: new Set(['disa_stig']) }), noVocabulary)).toBe(true)
  })
})

function applicabilityRow(id: string, applicability: Applicability): RuleRow {
  const osVersions = Object.keys(applicability).sort(compareVersionsDescending)
  const benchmarks = Array.from(new Set(osVersions.flatMap((version) => applicability[version].map((entry) => entry.name)))).sort()
  return row({ ref: { id: `mscp.${id}`, path: `mscp/rules/${id}.json` }, applicability, osVersions, benchmarks })
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
  const highOnTwoNoneOnOne = applicabilityRow('high_on_two', {
    '2.0': [{ name: 'acme_baseline', severity: 'high' }],
    '1.0': [{ name: 'acme_baseline', severity: null }],
  })
  const noneOnTwo = applicabilityRow('none_on_two', { '2.0': [{ name: 'acme_baseline', severity: null }] })
  const criticalOnOneLowOnTwo = applicabilityRow('critical_on_one', {
    '1.0': [{ name: 'acme_baseline', severity: 'critical' }],
    '2.0': [{ name: 'acme_baseline', severity: 'low' }],
  })
  const otherOnTwo = applicabilityRow('other_on_two', { '2.0': [{ name: 'other_baseline', severity: null }] })
  const mixedRows = [highOnTwoNoneOnOne, noneOnTwo, criticalOnOneLowOnTwo, otherOnTwo]
  const acme = (severity: string | null) => benchmarkFacetValue('acme_baseline', severity)
  const matchingIds = (filters: FilterValues) =>
    mixedRows.filter((r) => matchesFilters(r, filters, vocabulary)).map((r) => r.ref.id.slice('mscp.'.length))

  it('offers a no-severity option first, then one option per severity in vocabulary order, unlisted ones last', () => {
    expect(benchmarkOptionsInOrder(mixedRows, vocabulary)).toEqual([
      'other_baseline',
      acme(null),
      acme('low'),
      acme('high'),
      acme('critical'),
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
    expect(matchingIds(emptyFilters({ osVersions: new Set(['2.0']), benchmarks: new Set([acme(null)]) }))).toEqual(['none_on_two'])
    expect(matchingIds(emptyFilters({ osVersions: new Set(['1.0']), benchmarks: new Set([acme('high')]) }))).toEqual([])
    const onVersionOne = benchmarkOptionsUnder(mixedRows, emptyFilters({ osVersions: new Set(['1.0']) }), vocabulary)
    expect(new Set(onVersionOne)).toEqual(new Set([acme(null), acme('critical')]))
  })

  it('narrows the version facet to versions listing the selected severity', () => {
    expect(versionOptionsUnder(mixedRows, emptyFilters({ benchmarks: new Set([acme('high')]) }), vocabulary)).toEqual(['2.0'])
    expect(versionOptionsUnder(mixedRows, emptyFilters({ benchmarks: new Set([acme('critical')]) }), vocabulary)).toEqual(['1.0'])
    expect(versionOptionsUnder(mixedRows, emptyFilters({ benchmarks: new Set([acme(null)]) }), vocabulary)).toEqual(['1.0', '2.0'])
  })

  it('never offers a zero-row version and benchmark combination', () => {
    expectNoZeroRowCombination(mixedRows, vocabulary)
  })

  it('labels each option with the benchmark label and, when present, the severity label', () => {
    expect(benchmarkFacetLabel(vocabulary, acme(null))).toBe('Acme baseline')
    expect(benchmarkFacetLabel(vocabulary, acme('high'))).toBe('Acme baseline (High)')
    expect(benchmarkFacetLabel(vocabulary, acme('critical'))).toBe('Acme baseline (critical)')
    expect(benchmarkFacetLabel(noVocabulary, acme('high'))).toBe('acme_baseline (high)')
  })
})

describe('a grouped benchmark with severities', () => {
  const vocabulary = vocabularyIndexOf({
    benchmarks: [{ label: 'CIS Level 1', terms: ['cis_lvl1', 'cislevel1'] }],
    severities: [...SEVERITY_VOCABULARY.slice(0, 2), { label: 'High', terms: ['high', 'cat_i'] }],
  })
  const highUnderCurrentCode = applicabilityRow('current_high', { '26.0': [{ name: 'cis_lvl1', severity: 'high' }] })
  const highUnderRenamedCode = applicabilityRow('renamed_high', { '27.0': [{ name: 'cislevel1', severity: 'cat_i' }] })
  const lowAndNone = applicabilityRow('low_and_none', {
    '27.0': [{ name: 'cislevel1', severity: 'low' }],
    '26.0': [{ name: 'cis_lvl1', severity: null }],
  })
  const groupedRows = [highUnderCurrentCode, highUnderRenamedCode, lowAndNone]
  const cisLevelOne = (severity: string | null) => benchmarkFacetValue('cis_lvl1', severity)

  it('offers one option per benchmark group and severity group', () => {
    expect(benchmarkOptionsInOrder(groupedRows, vocabulary)).toEqual([cisLevelOne(null), cisLevelOne('low'), cisLevelOne('high')])
    expect(benchmarkFacetLabel(vocabulary, cisLevelOne('high'))).toBe('CIS Level 1 (High)')
  })

  it('matches rows listing either code of the group with that severity', () => {
    const filters = emptyFilters({ benchmarks: new Set([cisLevelOne('high')]) })
    expect(groupedRows.map((r) => matchesFilters(r, filters, vocabulary))).toEqual([true, true, false])
    expect(versionOptionsUnder(groupedRows, filters, vocabulary)).toEqual(['26.0', '27.0'])
    const lowFilters = emptyFilters({ benchmarks: new Set([cisLevelOne('low')]) })
    expect(versionOptionsUnder(groupedRows, lowFilters, vocabulary)).toEqual(['27.0'])
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

  it('orders benchmarks by the vocabulary, then no severity, listed severities and unlisted ones alphabetically', () => {
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
      { groupKey: 'a_first', severity: null },
      { groupKey: 'a_first', severity: 'low' },
      { groupKey: 'a_first', severity: 'medium' },
      { groupKey: 'a_first', severity: 'high' },
      { groupKey: 'a_first', severity: 'alpha' },
      { groupKey: 'a_first', severity: 'zeta' },
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

  it('offers one DISA STIG option per severity present, ordered by the severities vocabulary', () => {
    const stigOptions = benchmarkOptionsInOrder(committedRows, committedVocabulary).filter(
      (value) => parseBenchmarkFacetValue(value).groupKey === 'disa_stig',
    )
    expect(stigOptions.map((value) => benchmarkFacetLabel(committedVocabulary, value))).toEqual([
      'DISA STIG',
      'DISA STIG (low)',
      'DISA STIG (medium)',
      'DISA STIG (high)',
    ])
  })

  it('narrows the version facet by a severity option and the table to rows listing that severity', () => {
    const stigHigh = benchmarkFacetValue('disa_stig', 'high')
    const highOnTwentySeven = emptyFilters({ osVersions: new Set(['27.0']), benchmarks: new Set([stigHigh]) })
    const highRows = committedRows.filter((r) => matchesFilters(r, highOnTwentySeven, committedVocabulary))
    expect(highRows.length).toBeGreaterThan(0)
    for (const highRow of highRows) {
      expect(highRow.applicability['27.0']).toContainEqual({ name: 'disa_stig', severity: 'high' })
    }
    const stigHighSelected = emptyFilters({ benchmarks: new Set([stigHigh]) })
    expect(versionOptionsUnder(committedRows, stigHighSelected, committedVocabulary)).toEqual(['15.0', '26.0', '27.0'])
  })

  it('never offers a zero-row version and benchmark combination', () => {
    expectNoZeroRowCombination(committedRows, committedVocabulary)
  })
})
