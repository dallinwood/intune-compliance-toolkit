import type { FilterState } from '../state/filterStore'
import type { BenchmarkMembership } from '../types/library'
import type { RuleRow } from '../types/rule-row'
import { NO_TARGET_KEY, NO_VERSION_KEY, benchmarksAt } from './applicability'
import { upstreamRuleId } from './ruleDisplay'
import { compareGroupKeys, groupLabel, termGroupKey, type VocabularyIndex } from './vocabulary'

export type FilterValues = Pick<FilterState, 'search' | 'targets' | 'sources' | 'versions' | 'benchmarks' | 'sections' | 'tags' | 'automatable'>

// The Set-valued facets matchesFilters can be asked to ignore - used to
// compute "what values are still reachable in this facet, given every
// other currently-applied filter" for faceted-search-style narrowing.
export type FilterDimension = 'targets' | 'sources' | 'versions' | 'benchmarks' | 'sections' | 'tags'

// Filter state holds vocabulary group keys (benchmarks: group keys paired
// with a severity group key, see benchmarkFacetValue), so grouped codes (e.g.
// a benchmark mSCP renamed) filter as one. Every row code is mapped to its
// group key before it is compared.

function uniqueGroupKeys(index: VocabularyIndex, vocabulary: 'tags', codes: Iterable<string>): string[] {
  const groupKeys = new Set<string>()
  for (const code of codes) groupKeys.add(termGroupKey(index, vocabulary, code))
  return Array.from(groupKeys)
}

// The no-target and no-version keys stand for "None" and are never grouped
// through the vocabulary.
export function targetGroupKeys(row: RuleRow, index: VocabularyIndex): string[] {
  const groupKeys = row.targetKeys.map((key) => (key === NO_TARGET_KEY ? key : termGroupKey(index, 'targets', key)))
  return Array.from(new Set(groupKeys))
}

// Vocabulary order, then "None" last.
export function compareTargetGroupKeys(index: VocabularyIndex): (left: string, right: string) => number {
  const compareTargets = compareGroupKeys(index, 'targets')
  return (left, right) => {
    if (left === NO_TARGET_KEY || right === NO_TARGET_KEY) return Number(left === NO_TARGET_KEY) - Number(right === NO_TARGET_KEY)
    return compareTargets(left, right)
  }
}

function scopeGroupKey(index: VocabularyIndex, key: string): string {
  return key === NO_VERSION_KEY ? key : termGroupKey(index, 'versions', key)
}

export function sourceGroupKey(row: RuleRow, index: VocabularyIndex): string {
  return termGroupKey(index, 'sources', row.sourceName)
}

export function sectionGroupKey(row: RuleRow, index: VocabularyIndex): string {
  return termGroupKey(index, 'sections', row.section)
}

export function tagGroupKeys(row: RuleRow, index: VocabularyIndex): string[] {
  return uniqueGroupKeys(index, 'tags', row.tags)
}

export function versionsUnder(row: RuleRow, versions: ReadonlySet<string>, index: VocabularyIndex): string[] {
  if (versions.size === 0) return row.scopeKeys
  return row.scopeKeys.filter((key) => versions.has(scopeGroupKey(index, key)))
}

// A benchmark facet value is one (benchmark group, severity group) pair, so a
// benchmark whose entries carry severities offers one option per severity,
// plus a plain option for entries without one. The unit separator never
// occurs in the library's code words.
const SEVERITY_SEPARATOR = '\u001f'

export function benchmarkFacetValue(groupKey: string, severity: string | null): string {
  return severity === null ? groupKey : `${groupKey}${SEVERITY_SEPARATOR}${severity}`
}

export function parseBenchmarkFacetValue(value: string): { groupKey: string; severity: string | null } {
  const separatorPosition = value.indexOf(SEVERITY_SEPARATOR)
  if (separatorPosition === -1) return { groupKey: value, severity: null }
  return { groupKey: value.slice(0, separatorPosition), severity: value.slice(separatorPosition + SEVERITY_SEPARATOR.length) }
}

// The one place a row's benchmark entry becomes a facet value: the options
// offered and the rows they match both go through it, which is what keeps
// every offered option matching at least one row. An empty severity counts
// as none, as it does in benchmarkSummary.
export function membershipFacetValue(membership: BenchmarkMembership, index: VocabularyIndex): string {
  const severityGroupKey = membership.severity ? termGroupKey(index, 'severities', membership.severity) : null
  return benchmarkFacetValue(termGroupKey(index, 'benchmarks', membership.name), severityGroupKey)
}

// The benchmark groups that have at least one severity option among the
// given facet values.
export function benchmarkGroupsWithSeverities(values: Iterable<string>): Set<string> {
  const groupKeys = new Set<string>()
  for (const value of values) {
    const { groupKey, severity } = parseBenchmarkFacetValue(value)
    if (severity !== null) groupKeys.add(groupKey)
  }
  return groupKeys
}

// Beside severity options, a plain benchmark label would read as "any
// severity" though it matches only entries without one, so it says so.
export function benchmarkFacetLabel(index: VocabularyIndex, value: string, groupsWithSeverities: ReadonlySet<string>): string {
  const { groupKey, severity } = parseBenchmarkFacetValue(value)
  const benchmarkLabel = groupLabel(index, 'benchmarks', groupKey)
  if (severity !== null) return `${benchmarkLabel} (${groupLabel(index, 'severities', severity)})`
  return groupsWithSeverities.has(groupKey) ? `${benchmarkLabel} (no severity)` : benchmarkLabel
}

// Benchmarks in vocabulary order; within one benchmark, severities in
// vocabulary order, then the no-severity option.
export function compareBenchmarkFacetValues(index: VocabularyIndex): (left: string, right: string) => number {
  const compareBenchmarks = compareGroupKeys(index, 'benchmarks')
  const compareSeverities = compareGroupKeys(index, 'severities')
  return (left, right) => {
    const leftValue = parseBenchmarkFacetValue(left)
    const rightValue = parseBenchmarkFacetValue(right)
    const byBenchmark = compareBenchmarks(leftValue.groupKey, rightValue.groupKey)
    if (byBenchmark !== 0) return byBenchmark
    if (leftValue.severity === rightValue.severity) return 0
    if (leftValue.severity === null) return 1
    if (rightValue.severity === null) return -1
    return compareSeverities(leftValue.severity, rightValue.severity)
  }
}

function listsAnyBenchmark(row: RuleRow, key: string, benchmarks: ReadonlySet<string>, index: VocabularyIndex): boolean {
  return benchmarksAt(row.applicability, key).some((membership) => benchmarks.has(membershipFacetValue(membership, index)))
}

// A benchmark only counts for the versions it is listed under, so when
// versions are selected, a benchmark listed only under other versions must
// not match.
function matchesBenchmarks(row: RuleRow, filters: FilterValues, index: VocabularyIndex, excludeDimension?: FilterDimension): boolean {
  const selectedVersions = excludeDimension === 'versions' ? new Set<string>() : filters.versions
  return versionsUnder(row, selectedVersions, index).some((key) => listsAnyBenchmark(row, key, filters.benchmarks, index))
}

export function matchesFilters(
  row: RuleRow,
  filters: FilterValues,
  index: VocabularyIndex,
  excludeDimension?: FilterDimension,
): boolean {
  if (excludeDimension !== 'targets' && filters.targets.size > 0 && !targetGroupKeys(row, index).some((target) => filters.targets.has(target)))
    return false
  if (excludeDimension !== 'sources' && filters.sources.size > 0 && !filters.sources.has(sourceGroupKey(row, index)))
    return false
  if (excludeDimension !== 'versions' && filters.versions.size > 0 && versionsUnder(row, filters.versions, index).length === 0)
    return false
  if (excludeDimension !== 'benchmarks' && filters.benchmarks.size > 0 && !matchesBenchmarks(row, filters, index, excludeDimension))
    return false
  if (excludeDimension !== 'sections' && filters.sections.size > 0 && !filters.sections.has(sectionGroupKey(row, index)))
    return false
  if (excludeDimension !== 'tags' && filters.tags.size > 0 && !tagGroupKeys(row, index).some((tag) => filters.tags.has(tag)))
    return false
  if (filters.automatable === 'automatable' && row.assessment.status !== 'automated') return false
  if (filters.automatable === 'manual' && row.assessment.status !== 'manual') return false

  const needle = filters.search.trim().toLowerCase()
  if (needle) {
    if (!row.title.toLowerCase().includes(needle) && !upstreamRuleId(row.ref.id).toLowerCase().includes(needle)) return false
  }

  return true
}

// Facet-narrowing for the filter sidebar: which values remain reachable in
// one facet once every *other* currently-applied filter is taken into
// account (e.g. picking a benchmark narrows the version list down
// to versions that list that benchmark). The facet being
// computed is excluded from its own narrowing, or picking a value could
// never un-narrow itself. Any already-selected value is always included
// even if it no longer matches - otherwise a selection that becomes
// unreachable (e.g. two mutually-exclusive picks across facets) would
// vanish from the list with no way left to un-check it.
export function facetOptions(
  rows: RuleRow[],
  filters: FilterValues,
  dimension: FilterDimension,
  valueOf: (row: RuleRow) => string | string[],
  selected: Iterable<string>,
  index: VocabularyIndex,
): string[] {
  const present = new Set<string>()
  for (const row of rows) {
    if (!matchesFilters(row, filters, index, dimension)) continue
    const value = valueOf(row)
    if (Array.isArray(value)) value.forEach((entry) => present.add(entry))
    else present.add(value)
  }
  for (const value of selected) present.add(value)
  return Array.from(present).sort((a, b) => a.localeCompare(b))
}

// Every distinct value for one facet dimension, across every row,
// independent of any currently-applied filter. Used as a fixed reference
// order so a facet's rows never reorder as filtering narrows which of them
// are reachable - only their reachable/shown state changes (see
// FilterSidebar's stabilization logic), so checking one box collapses at
// most the rows that actually became unreachable instead of reshuffling
// the whole list.
export function allFacetValues(
  rows: RuleRow[],
  valueOf: (row: RuleRow) => string | string[],
  compareValues: (left: string, right: string) => number = (left, right) => left.localeCompare(right),
): string[] {
  const present = new Set<string>()
  for (const row of rows) {
    const value = valueOf(row)
    if (Array.isArray(value)) value.forEach((entry) => present.add(entry))
    else present.add(value)
  }
  return Array.from(present).sort(compareValues)
}

// Version-scoped facet values: version group keys and benchmark facet
// values. A row's benchmarks differ per version, so the benchmark facet
// must only count benchmarks listed under the selected versions (and the
// version facet only versions listing a selected benchmark) - otherwise it
// offers combinations that match zero rows.
export function benchmarksListedUnder(row: RuleRow, versions: ReadonlySet<string>, index: VocabularyIndex): string[] {
  const facetValues = versionsUnder(row, versions, index).flatMap((key) =>
    benchmarksAt(row.applicability, key).map((membership) => membershipFacetValue(membership, index)),
  )
  return Array.from(new Set(facetValues))
}

export function versionsListingAnyOf(row: RuleRow, benchmarks: ReadonlySet<string>, index: VocabularyIndex): string[] {
  const keys = benchmarks.size === 0 ? row.scopeKeys : row.scopeKeys.filter((key) => listsAnyBenchmark(row, key, benchmarks, index))
  return Array.from(new Set(keys.map((key) => scopeGroupKey(index, key))))
}

// Every facet value some row offers, per dimension, ignoring all filters. A
// value restored from a shared URL that is not in here matches no option.
export function knownFacetValues(rows: RuleRow[], index: VocabularyIndex): Record<FilterDimension, Set<string>> {
  const noSelection: ReadonlySet<string> = new Set()
  const known: Record<FilterDimension, Set<string>> = {
    targets: new Set(),
    sources: new Set(),
    versions: new Set(),
    benchmarks: new Set(),
    sections: new Set(),
    tags: new Set(),
  }
  for (const row of rows) {
    targetGroupKeys(row, index).forEach((value) => known.targets.add(value))
    known.sources.add(sourceGroupKey(row, index))
    versionsListingAnyOf(row, noSelection, index).forEach((value) => known.versions.add(value))
    benchmarksListedUnder(row, noSelection, index).forEach((value) => known.benchmarks.add(value))
    known.sections.add(sectionGroupKey(row, index))
    tagGroupKeys(row, index).forEach((value) => known.tags.add(value))
  }
  return known
}
