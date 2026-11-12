import { upstreamRuleId } from './ruleDisplay'

export type PaletteEntry =
  | { kind: 'view'; key: string; viewId: string; label: string; matchText: string }
  | { kind: 'framework'; key: string; sourceName: string; label: string; shortLabel: string; matchText: string }
  | { kind: 'rule'; key: string; ruleId: string; upstreamId: string; title: string; sourceLabel: string; matchText: string }

export interface PaletteResults {
  views: PaletteEntry[]
  frameworks: PaletteEntry[]
  rules: PaletteEntry[]
  totalRuleMatches: number
}

export const RULE_RESULT_LIMIT = 50

type RuleEntry = Extract<PaletteEntry, { kind: 'rule' }>

export function buildPaletteEntries(
  views: readonly { id: string; label: string }[],
  sources: readonly { name: string; display_name: string }[],
  rows: readonly { ref: { id: string }; title: string; sourceName: string }[],
  sourceLabel: (sourceName: string) => string,
): PaletteEntry[] {
  const viewEntries: PaletteEntry[] = views.map((view) => ({
    kind: 'view',
    key: `view:${view.id}`,
    viewId: view.id,
    label: view.label,
    matchText: `${view.label} ${view.id}`.toLowerCase(),
  }))
  const frameworkEntries: PaletteEntry[] = sources.map((source) => {
    const shortLabel = sourceLabel(source.name)
    return {
      kind: 'framework',
      key: `framework:${source.name}`,
      sourceName: source.name,
      label: source.display_name,
      shortLabel,
      matchText: `${source.display_name} ${shortLabel} ${source.name}`.toLowerCase(),
    }
  })
  const ruleEntries: PaletteEntry[] = rows
    .map((row) => {
      const upstreamId = upstreamRuleId(row.ref.id)
      const label = sourceLabel(row.sourceName)
      return {
        kind: 'rule' as const,
        key: `rule:${row.ref.id}`,
        ruleId: row.ref.id,
        upstreamId,
        title: row.title,
        sourceLabel: label,
        matchText: `${row.ref.id} ${upstreamId} ${row.title} ${label}`.toLowerCase(),
      }
    })
    .sort((first, second) => compareText(first.ruleId, second.ruleId))
  return [...viewEntries, ...frameworkEntries, ...ruleEntries]
}

function compareText(first: string, second: string): number {
  if (first < second) return -1
  return first > second ? 1 : 0
}

export function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, ' ')
}

function matchesEveryWord(entry: PaletteEntry, words: readonly string[]): boolean {
  return words.every((word) => entry.matchText.includes(word))
}

const EXACT_ID_TIER = 0
const UPSTREAM_PREFIX_TIER = 1
const TITLE_PREFIX_TIER = 2
const UPSTREAM_SUBSTRING_TIER = 3
const OTHER_MATCH_TIER = 4

function rankingTier(entry: RuleEntry, normalizedQuery: string): number {
  const upstreamId = entry.upstreamId.toLowerCase()
  if (normalizedQuery === upstreamId || normalizedQuery === entry.ruleId.toLowerCase()) return EXACT_ID_TIER
  if (upstreamId.startsWith(normalizedQuery)) return UPSTREAM_PREFIX_TIER
  if (entry.title.toLowerCase().startsWith(normalizedQuery)) return TITLE_PREFIX_TIER
  if (upstreamId.includes(normalizedQuery)) return UPSTREAM_SUBSTRING_TIER
  return OTHER_MATCH_TIER
}

function rankRules(rules: RuleEntry[], normalizedQuery: string): RuleEntry[] {
  return rules
    .map((entry) => ({ entry, tier: rankingTier(entry, normalizedQuery) }))
    .sort(
      (first, second) =>
        first.tier - second.tier ||
        first.entry.upstreamId.localeCompare(second.entry.upstreamId, 'en', { numeric: true }) ||
        compareText(first.entry.ruleId, second.entry.ruleId),
    )
    .map(({ entry }) => entry)
}

export function searchPalette(
  entries: readonly PaletteEntry[],
  query: string,
  ruleLimit: number = RULE_RESULT_LIMIT,
): PaletteResults {
  const normalizedQuery = normalizeQuery(query)
  if (normalizedQuery === '') {
    return {
      views: entries.filter((entry) => entry.kind === 'view'),
      frameworks: entries.filter((entry) => entry.kind === 'framework'),
      rules: [],
      totalRuleMatches: 0,
    }
  }
  const words = normalizedQuery.split(' ')
  const matching = entries.filter((entry) => matchesEveryWord(entry, words))
  const matchingRules = rankRules(
    matching.filter((entry): entry is RuleEntry => entry.kind === 'rule'),
    normalizedQuery,
  )
  return {
    views: matching.filter((entry) => entry.kind === 'view'),
    frameworks: matching.filter((entry) => entry.kind === 'framework'),
    rules: matchingRules.slice(0, ruleLimit),
    totalRuleMatches: matchingRules.length,
  }
}

export function resultStatus(results: PaletteResults): string {
  const total = results.views.length + results.frameworks.length + results.rules.length
  if (total === 0) return 'No matches'
  if (results.totalRuleMatches > results.rules.length) {
    return `Showing ${results.rules.length} of ${results.totalRuleMatches} rules; keep typing to narrow`
  }
  return total === 1 ? '1 result' : `${total} results`
}

export function isPaletteShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'defaultPrevented'>,
): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    !event.isComposing &&
    !event.defaultPrevented &&
    event.key.toLowerCase() === 'k'
  )
}

const APPLE_PLATFORM_PATTERN = /Mac|iPhone|iPad|iPod/

export function isApplePlatform(platform: string, userAgent: string): boolean {
  return APPLE_PLATFORM_PATTERN.test(platform === '' ? userAgent : platform)
}
