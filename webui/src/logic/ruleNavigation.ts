import type { RuleRow } from '../types/rule-row'
import { upstreamRuleId } from './ruleDisplay'
import { matchesFilters, type FilterDimension, type FilterValues } from './ruleFilters'
import type { VocabularyIndex } from './vocabulary'

const FACETS: readonly FilterDimension[] = ['targets', 'sources', 'versions', 'benchmarks', 'sections', 'tags']

function noFilters(): FilterValues {
  return {
    search: '',
    targets: new Set(),
    sources: new Set(),
    versions: new Set(),
    benchmarks: new Set(),
    sections: new Set(),
    tags: new Set(),
    automatable: 'all',
  }
}

// The filters that show `row` when following a link to it: the search
// becomes its upstream id, and only the filters that would hide it are
// cleared. A filter that hides it on its own is cleared; if facets only hide
// it together (a benchmark listed under another selected version), every
// facet is cleared.
export function filtersShowingRule(row: RuleRow, filters: FilterValues, index: VocabularyIndex): FilterValues {
  let next: FilterValues = { ...filters, search: upstreamRuleId(row.ref.id) }
  if (matchesFilters(row, next, index)) return next
  for (const facet of FACETS) {
    if (!matchesFilters(row, { ...noFilters(), [facet]: next[facet] }, index)) next = { ...next, [facet]: new Set<string>() }
  }
  if (!matchesFilters(row, { ...noFilters(), automatable: next.automatable }, index)) next = { ...next, automatable: 'all' }
  if (matchesFilters(row, next, index)) return next
  return { ...noFilters(), search: next.search, automatable: next.automatable }
}
