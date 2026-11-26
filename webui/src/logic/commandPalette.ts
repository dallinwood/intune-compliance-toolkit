import { compareNatural } from './naturalOrder'
import { upstreamRuleId } from './ruleDisplay'

export type PaletteEntry =
  | { kind: 'view'; key: string; viewId: string; label: string; matchText: string }
  | { kind: 'framework'; key: string; sourceName: string; label: string; shortLabel: string; matchText: string }
  | { kind: 'rule'; key: string; ruleId: string; upstreamId: string; title: string; sourceLabel: string; matchText: string }
  | { kind: 'licence'; key: string; catalogId: string; label: string; matchText: string }
  | { kind: 'product'; key: string; catalogId: string; label: string; matchText: string }

export interface PaletteResults {
  views: PaletteEntry[]
  frameworks: PaletteEntry[]
  licences: PaletteEntry[]
  products: PaletteEntry[]
  rules: PaletteEntry[]
  totalLicenceMatches: number
  totalProductMatches: number
  totalRuleMatches: number
}

export const RULE_RESULT_LIMIT = 50
// Small, so a short query that matches hundreds of products does not push the
// rules out of sight.
export const CATALOG_RESULT_LIMIT = 10

type RuleEntry = Extract<PaletteEntry, { kind: 'rule' }>
type CatalogEntry = Extract<PaletteEntry, { kind: 'licence' | 'product' }>

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

// Built apart from the other entries because the catalog loads later, and
// only once the palette is first opened.
export function buildCatalogPaletteEntries(catalog: {
  licences: readonly { id: string; title: string; family: string }[]
  products: readonly { id: string; title: string; category: string | null }[]
}): PaletteEntry[] {
  const licenceEntries: PaletteEntry[] = catalog.licences.map((licence) => ({
    kind: 'licence',
    key: `licence:${licence.id}`,
    catalogId: licence.id,
    label: licence.title,
    matchText: `${licence.title} ${licence.family} ${licence.id}`.toLowerCase(),
  }))
  const productEntries: PaletteEntry[] = catalog.products.map((product) => ({
    kind: 'product',
    key: `product:${product.id}`,
    catalogId: product.id,
    label: product.title,
    matchText: `${product.title} ${product.category ?? ''} ${product.id}`.toLowerCase(),
  }))
  return [...licenceEntries, ...productEntries]
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

// One collator for the whole sort: calling localeCompare per comparison builds
// a collator each time, which is about 15 times slower over the full library.
const UPSTREAM_ID_COLLATOR = new Intl.Collator('en', { numeric: true })

function rankRules(rules: RuleEntry[], normalizedQuery: string): RuleEntry[] {
  return rules
    .map((entry) => ({ entry, tier: rankingTier(entry, normalizedQuery) }))
    .sort(
      (first, second) =>
        first.tier - second.tier ||
        UPSTREAM_ID_COLLATOR.compare(first.entry.upstreamId, second.entry.upstreamId) ||
        compareText(first.entry.ruleId, second.entry.ruleId),
    )
    .map(({ entry }) => entry)
}

function rankCatalogEntries(entries: CatalogEntry[], normalizedQuery: string): CatalogEntry[] {
  const startsWithQuery = (entry: CatalogEntry) => entry.label.toLowerCase().startsWith(normalizedQuery)
  return entries.toSorted(
    (first, second) => Number(startsWithQuery(second)) - Number(startsWithQuery(first)) || compareNatural(first.label, second.label),
  )
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
      licences: [],
      products: [],
      rules: [],
      totalLicenceMatches: 0,
      totalProductMatches: 0,
      totalRuleMatches: 0,
    }
  }
  const words = normalizedQuery.split(' ')
  const matching = entries.filter((entry) => matchesEveryWord(entry, words))
  const matchingRules = rankRules(
    matching.filter((entry): entry is RuleEntry => entry.kind === 'rule'),
    normalizedQuery,
  )
  const matchingLicences = rankCatalogEntries(
    matching.filter((entry): entry is CatalogEntry => entry.kind === 'licence'),
    normalizedQuery,
  )
  const matchingProducts = rankCatalogEntries(
    matching.filter((entry): entry is CatalogEntry => entry.kind === 'product'),
    normalizedQuery,
  )
  return {
    views: matching.filter((entry) => entry.kind === 'view'),
    frameworks: matching.filter((entry) => entry.kind === 'framework'),
    licences: matchingLicences.slice(0, CATALOG_RESULT_LIMIT),
    products: matchingProducts.slice(0, CATALOG_RESULT_LIMIT),
    rules: matchingRules.slice(0, ruleLimit),
    totalLicenceMatches: matchingLicences.length,
    totalProductMatches: matchingProducts.length,
    totalRuleMatches: matchingRules.length,
  }
}

export function resultStatus(results: PaletteResults): string {
  const shown =
    results.views.length + results.frameworks.length + results.licences.length + results.products.length + results.rules.length
  const total =
    results.views.length + results.frameworks.length + results.totalLicenceMatches + results.totalProductMatches + results.totalRuleMatches
  if (total === 0) return 'No matches'
  if (total > shown) return `Showing ${shown} of ${total} results; keep typing to narrow`
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
