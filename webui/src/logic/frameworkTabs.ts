import type { FrameworkTab } from '../state/urlState'
import { ALL_FRAMEWORKS } from '../state/urlState'
import type { FrameworkPair } from './frameworkPairs'

// The page that lists every rule has only the Rules sub-tab, and a framework
// with no pairs has no Coverage sub-tab; anything else falls back to Rules.
export function resolveFrameworkTab(tab: FrameworkTab | null, isAll: boolean, hasCoverage: boolean): FrameworkTab {
  if (tab === null || isAll) return 'rules'
  if (tab === 'coverage' && !hasCoverage) return 'rules'
  return tab
}

export function frameworkHasPairs(pairs: readonly FrameworkPair[], sourceName: string): boolean {
  return pairs.some((pair) =>
    pair.kind === 'supports' ? pair.coveringSource === sourceName || pair.coveredSource === sourceName : pair.sources.includes(sourceName),
  )
}

export interface ResolvedFrameworkPage<Source> {
  source: Source | typeof ALL_FRAMEWORKS
  tab: FrameworkTab
  hasCoverage: boolean
}

// null is the card grid: no framework, or one the library does not have.
export function resolveFrameworkPage<Source extends { name: string }>(
  framework: string | null,
  tab: FrameworkTab | null,
  sources: readonly Source[],
  pairs: readonly FrameworkPair[],
): ResolvedFrameworkPage<Source> | null {
  if (framework === ALL_FRAMEWORKS) return { source: ALL_FRAMEWORKS, tab: resolveFrameworkTab(tab, true, false), hasCoverage: false }
  const source = sources.find((candidate) => candidate.name === framework)
  if (source === undefined) return null
  const hasCoverage = frameworkHasPairs(pairs, source.name)
  return { source, tab: resolveFrameworkTab(tab, false, hasCoverage), hasCoverage }
}
