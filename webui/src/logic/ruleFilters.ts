import type { FilterState } from '../state/filterStore'
import type { RuleRow } from '../types/rule-row'

export type FilterValues = Pick<FilterState, 'search' | 'products' | 'versions' | 'platforms' | 'profiles' | 'automatable'>

// The Set-valued facets matchesFilters can be asked to ignore - used to
// compute "what values are still reachable in this facet, given every
// other currently-applied filter" for faceted-search-style narrowing.
export type FilterDimension = 'products' | 'versions' | 'platforms' | 'profiles'

export function matchesFilters(row: RuleRow, filters: FilterValues, excludeDimension?: FilterDimension): boolean {
  if (excludeDimension !== 'products' && filters.products.size > 0 && !filters.products.has(row.ref.product)) return false
  if (excludeDimension !== 'versions' && filters.versions.size > 0 && !filters.versions.has(row.ref.version)) return false
  if (excludeDimension !== 'platforms' && filters.platforms.size > 0 && !filters.platforms.has(row.platform)) return false
  if (
    excludeDimension !== 'profiles' &&
    filters.profiles.size > 0 &&
    !row.profileApplicability.some((profile) => filters.profiles.has(profile))
  )
    return false
  if (filters.automatable === 'automatable' && row.assessmentStatus !== 'Automated') return false
  if (filters.automatable === 'manual' && row.assessmentStatus !== 'Manual') return false

  const needle = filters.search.trim().toLowerCase()
  if (needle && !row.title.toLowerCase().includes(needle) && !row.ref.id.includes(needle)) return false

  return true
}

// Facet-narrowing for the filter sidebar: which values remain reachable in
// one facet once every *other* currently-applied filter is taken into
// account (e.g. picking product "windows_11" narrows the version list down
// to versions that actually exist under that product). The facet being
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
