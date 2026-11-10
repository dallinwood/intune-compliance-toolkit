import type { ReleaseComparison, RuleComparison } from './historyIndex'
import { CHANGE_KINDS, type ChangeKind } from './ruleChanges'

export interface ComparisonFilters {
  kinds: ReadonlySet<ChangeKind>
  search: string
  sections: string[]
  benchmarks: string[]
  // null: no narrowing; a set (possibly empty): only these rules.
  onlyRuleIds: ReadonlySet<string> | null
}

// The kinds ticked after one is toggled. null is the untouched state: every
// kind ticked and no parameter in the address; ticking all four goes back to it.
export function toggledKindSelection(current: readonly ChangeKind[] | null, kind: ChangeKind): ChangeKind[] | null {
  const before = current ?? CHANGE_KINDS
  const next = CHANGE_KINDS.filter((candidate) => (candidate === kind ? !before.includes(candidate) : before.includes(candidate)))
  return next.length === CHANGE_KINDS.length ? null : next
}

function matchesSearch(entry: RuleComparison, search: string): boolean {
  const wanted = search.trim().toLowerCase()
  return wanted === '' || entry.id.toLowerCase().includes(wanted) || entry.title.toLowerCase().includes(wanted)
}

function matchesAllButKindsAndFacets(entry: RuleComparison, filters: ComparisonFilters): boolean {
  return matchesSearch(entry, filters.search) && (filters.onlyRuleIds === null || filters.onlyRuleIds.has(entry.id))
}

function matchesSections(entry: RuleComparison, sections: string[]): boolean {
  return sections.length === 0 || sections.includes(entry.section)
}

function matchesBenchmarks(entry: RuleComparison, benchmarks: string[]): boolean {
  return benchmarks.length === 0 || entry.benchmarks.some((benchmark) => benchmarks.includes(benchmark))
}

// Added and removed rules have no kinds of change, so the kind filter only narrows the changed ones.
function matchesKinds(entry: RuleComparison, kinds: ReadonlySet<ChangeKind>, isChanged: boolean): boolean {
  return !isChanged || entry.kinds.some((kind) => kinds.has(kind))
}

function filtered(
  comparison: ReleaseComparison,
  filters: ComparisonFilters,
  ignoring: { kinds?: boolean; sections?: boolean; benchmarks?: boolean },
): ReleaseComparison {
  const keep = (isChanged: boolean) => (entry: RuleComparison) =>
    matchesAllButKindsAndFacets(entry, filters) &&
    (ignoring.sections || matchesSections(entry, filters.sections)) &&
    (ignoring.benchmarks || matchesBenchmarks(entry, filters.benchmarks)) &&
    (ignoring.kinds || matchesKinds(entry, filters.kinds, isChanged))
  return {
    added: comparison.added.filter(keep(false)),
    removed: comparison.removed.filter(keep(false)),
    changed: comparison.changed.filter(keep(true)),
    unchanged: comparison.unchanged.filter(keep(false)),
  }
}

export function filterComparison(comparison: ReleaseComparison, filters: ComparisonFilters): ReleaseComparison {
  return filtered(comparison, filters, {})
}

export interface ComparisonFacetCounts {
  kinds: Record<ChangeKind, number>
  sections: Map<string, number>
  benchmarks: Map<string, number>
}

function allEntries(comparison: ReleaseComparison): RuleComparison[] {
  return [...comparison.added, ...comparison.removed, ...comparison.changed]
}

// Each facet's counts apply every other filter, so a count says how many
// rules ticking that option would leave in view.
export function comparisonFacetCounts(comparison: ReleaseComparison, filters: ComparisonFilters): ComparisonFacetCounts {
  const kinds = Object.fromEntries(CHANGE_KINDS.map((kind) => [kind, 0])) as Record<ChangeKind, number>
  for (const entry of filtered(comparison, filters, { kinds: true }).changed) {
    for (const kind of entry.kinds) kinds[kind] += 1
  }
  const sections = new Map<string, number>()
  for (const entry of allEntries(filtered(comparison, filters, { sections: true }))) {
    sections.set(entry.section, (sections.get(entry.section) ?? 0) + 1)
  }
  const benchmarks = new Map<string, number>()
  for (const entry of allEntries(filtered(comparison, filters, { benchmarks: true }))) {
    for (const benchmark of entry.benchmarks) benchmarks.set(benchmark, (benchmarks.get(benchmark) ?? 0) + 1)
  }
  return { kinds, sections, benchmarks }
}
