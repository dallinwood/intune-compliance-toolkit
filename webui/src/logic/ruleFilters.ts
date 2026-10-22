import type { FilterState } from '../state/filterStore'
import type { RuleRow } from '../types/rule-row'
import { termGroupKey, type VocabularyIndex } from './vocabulary'

export type FilterValues = Pick<FilterState, 'search' | 'osVersions' | 'benchmarks' | 'sections' | 'tags' | 'automatable'>

// The Set-valued facets matchesFilters can be asked to ignore - used to
// compute "what values are still reachable in this facet, given every
// other currently-applied filter" for faceted-search-style narrowing.
export type FilterDimension = 'osVersions' | 'benchmarks' | 'sections' | 'tags'

const MSCP_ID_PREFIX = 'mscp.'

// Filter state holds vocabulary group keys, so grouped codes (e.g. a
// benchmark mSCP renamed) filter as one. Every row code is mapped to its
// group key before it is compared.

function uniqueGroupKeys(index: VocabularyIndex, vocabulary: 'benchmarks' | 'os_versions' | 'tags', codes: Iterable<string>): string[] {
  const groupKeys = new Set<string>()
  for (const code of codes) groupKeys.add(termGroupKey(index, vocabulary, code))
  return Array.from(groupKeys)
}

export function sectionGroupKey(row: RuleRow, index: VocabularyIndex): string {
  return termGroupKey(index, 'sections', row.section)
}

export function tagGroupKeys(row: RuleRow, index: VocabularyIndex): string[] {
  return uniqueGroupKeys(index, 'tags', row.tags)
}

function versionsUnder(row: RuleRow, osVersions: ReadonlySet<string>, index: VocabularyIndex): string[] {
  if (osVersions.size === 0) return row.osVersions
  return row.osVersions.filter((version) => osVersions.has(termGroupKey(index, 'os_versions', version)))
}

function listsAnyBenchmark(row: RuleRow, version: string, benchmarks: ReadonlySet<string>, index: VocabularyIndex): boolean {
  return (row.applicability[version] ?? []).some((benchmark) => benchmarks.has(termGroupKey(index, 'benchmarks', benchmark.name)))
}

// A benchmark only counts for the macOS versions it is listed under, so when
// versions are selected, a benchmark listed only under other versions must
// not match.
function matchesBenchmarks(row: RuleRow, filters: FilterValues, index: VocabularyIndex, excludeDimension?: FilterDimension): boolean {
  const selectedVersions = excludeDimension === 'osVersions' ? new Set<string>() : filters.osVersions
  return versionsUnder(row, selectedVersions, index).some((version) => listsAnyBenchmark(row, version, filters.benchmarks, index))
}

export function matchesFilters(
  row: RuleRow,
  filters: FilterValues,
  index: VocabularyIndex,
  excludeDimension?: FilterDimension,
): boolean {
  if (excludeDimension !== 'osVersions' && filters.osVersions.size > 0 && versionsUnder(row, filters.osVersions, index).length === 0)
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
    const upstreamId = row.ref.id.startsWith(MSCP_ID_PREFIX) ? row.ref.id.slice(MSCP_ID_PREFIX.length) : row.ref.id
    if (!row.title.toLowerCase().includes(needle) && !upstreamId.toLowerCase().includes(needle)) return false
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

// Version-scoped facet values, as group keys. A row's benchmarks differ per
// macOS version, so the benchmark facet must only count benchmarks listed
// under the selected versions (and the version facet only versions listing a
// selected benchmark) - otherwise it offers combinations that match zero rows.
export function benchmarksListedUnder(row: RuleRow, osVersions: ReadonlySet<string>, index: VocabularyIndex): string[] {
  const benchmarkNames = versionsUnder(row, osVersions, index).flatMap((version) =>
    (row.applicability[version] ?? []).map((benchmark) => benchmark.name),
  )
  return uniqueGroupKeys(index, 'benchmarks', benchmarkNames)
}

export function versionsListingAnyOf(row: RuleRow, benchmarks: ReadonlySet<string>, index: VocabularyIndex): string[] {
  const versions = benchmarks.size === 0 ? row.osVersions : row.osVersions.filter((version) => listsAnyBenchmark(row, version, benchmarks, index))
  return uniqueGroupKeys(index, 'os_versions', versions)
}
