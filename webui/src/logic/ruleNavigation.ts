import type { RuleRow } from '../types/rule-row'
import { upstreamRuleId } from './ruleDisplay'
import { matchesFilters, type FilterDimension, type FilterValues } from './ruleFilters'
import type { LinkedFrameworksByRule } from './linkedFrameworks'
import type { VocabularyIndex } from './vocabulary'

const FACETS: readonly FilterDimension[] = ['targets', 'sources', 'versions', 'benchmarks', 'sections', 'tags', 'linked']

function noFilters(): FilterValues {
  return {
    search: '',
    targets: new Set(),
    sources: new Set(),
    versions: new Set(),
    benchmarks: new Set(),
    sections: new Set(),
    tags: new Set(),
    linked: new Set(),
    automatable: 'all',
  }
}

// The filters that show `row` when following a link to it: the search
// becomes its upstream id, and only the filters that would hide it are
// cleared. A filter that hides it on its own is cleared; if facets only hide
// it together (a benchmark listed under another selected version), every
// facet is cleared.
export function filtersShowingRule(
  row: RuleRow,
  filters: FilterValues,
  index: VocabularyIndex,
  linkedFrameworks?: LinkedFrameworksByRule,
): FilterValues {
  // Copied field by field: callers pass the whole store state, and spreading
  // it would carry the current framework page into the change.
  let next: FilterValues = {
    search: upstreamRuleId(row.ref.id),
    targets: filters.targets,
    sources: filters.sources,
    versions: filters.versions,
    benchmarks: filters.benchmarks,
    sections: filters.sections,
    tags: filters.tags,
    linked: filters.linked,
    automatable: filters.automatable,
  }
  if (matchesFilters(row, next, index, undefined, linkedFrameworks)) return next
  for (const facet of FACETS) {
    if (!matchesFilters(row, { ...noFilters(), [facet]: next[facet] }, index, undefined, linkedFrameworks)) next = { ...next, [facet]: new Set<string>() }
  }
  if (!matchesFilters(row, { ...noFilters(), automatable: next.automatable }, index, undefined, linkedFrameworks)) next = { ...next, automatable: 'all' }
  if (matchesFilters(row, next, index, undefined, linkedFrameworks)) return next
  return { ...noFilters(), search: next.search, automatable: next.automatable }
}
