import type { FilterState } from '../state/filterStore'
import type { RuleRow } from '../types/rule-row'

export type FilterValues = Pick<FilterState, 'search' | 'osVersions' | 'benchmarks' | 'sections' | 'tags' | 'automatable'>

// The Set-valued facets matchesFilters can be asked to ignore - used to
// compute "what values are still reachable in this facet, given every
// other currently-applied filter" for faceted-search-style narrowing.
export type FilterDimension = 'osVersions' | 'benchmarks' | 'sections' | 'tags'

const MSCP_ID_PREFIX = 'mscp.'

// A benchmark only counts for the macOS versions it is listed under, so when
// versions are selected, a benchmark listed only under other versions must
// not match.
function matchesBenchmarks(row: RuleRow, filters: FilterValues, excludeDimension?: FilterDimension): boolean {
  const versionsToConsider =
    excludeDimension !== 'osVersions' && filters.osVersions.size > 0
      ? row.osVersions.filter((version) => filters.osVersions.has(version))
      : row.osVersions
  return versionsToConsider.some((version) =>
    (row.applicability[version] ?? []).some((benchmark) => filters.benchmarks.has(benchmark.name)),
  )
}

export function matchesFilters(row: RuleRow, filters: FilterValues, excludeDimension?: FilterDimension): boolean {
  if (
    excludeDimension !== 'osVersions' &&
    filters.osVersions.size > 0 &&
    !row.osVersions.some((version) => filters.osVersions.has(version))
  )
    return false
  if (excludeDimension !== 'benchmarks' && filters.benchmarks.size > 0 && !matchesBenchmarks(row, filters, excludeDimension))
    return false
  if (excludeDimension !== 'sections' && filters.sections.size > 0 && !filters.sections.has(row.section)) return false
  if (excludeDimension !== 'tags' && filters.tags.size > 0 && !row.tags.some((tag) => filters.tags.has(tag))) return false
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
): string[] {
  const present = new Set<string>()
  for (const row of rows) {
    if (!matchesFilters(row, filters, dimension)) continue
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
export function allFacetValues(rows: RuleRow[], valueOf: (row: RuleRow) => string | string[]): string[] {
  const present = new Set<string>()
  for (const row of rows) {
    const value = valueOf(row)
    if (Array.isArray(value)) value.forEach((entry) => present.add(entry))
    else present.add(value)
  }
  return Array.from(present).sort((a, b) => a.localeCompare(b))
}
