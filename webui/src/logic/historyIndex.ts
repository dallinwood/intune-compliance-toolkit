// A history index is built at publish time (scripts/copy-baselines.mjs), one
// per source: for every rule and release, one fingerprint per kind of change
// (see ruleChanges.ts). Comparing two releases or drawing a rule's timeline
// then needs no rule file at all; a rule's release files are fetched only to
// draw a field-level diff.
import type { ManifestSource, Rule } from '../types/library'
import { CHANGE_KINDS, kindFingerprints, type ChangeKind, type KindFingerprints } from './ruleChanges'

export const HISTORY_INDEX_SCHEMA_VERSION = 1

export interface HistoryRelease {
  tag: string
  label: string
  published_date: string
  index_path: string
}

export interface HistoryRuleEntry {
  title: string
  // Relative to the directory of a release's index_path, for example rules/ism-0359.json.
  file: string
  section: string
  benchmarks: string[]
  // Aligned with HistoryIndex.releases (oldest first); null: the rule is absent from that release.
  versions: (KindFingerprints | null)[]
}

export interface HistoryIndex {
  schema_version: typeof HISTORY_INDEX_SCHEMA_VERSION
  source: string
  releases: HistoryRelease[]
  rules: Record<string, HistoryRuleEntry>
}

// A rule as read from its release folder, with the file it came from (the
// loader's bookkeeping field, ignored when comparing).
export type RuleWithFile = Rule & { file: string }

function benchmarkNamesOf(rule: Rule): string[] {
  return [...new Set(rule.applicability.flatMap((entry) => entry.benchmarks.map((benchmark) => benchmark.name)))].sort()
}

export function buildHistoryIndex(source: ManifestSource, rulesByTag: ReadonlyMap<string, RuleWithFile[]>): HistoryIndex {
  const releases = source.releases.map(({ tag, label, published_date, index_path }) => ({ tag, label, published_date, index_path }))
  const rules: Record<string, HistoryRuleEntry> = {}
  releases.forEach((release, releasePosition) => {
    for (const rule of rulesByTag.get(release.tag) ?? []) {
      const entry = (rules[rule.id] ??= {
        title: rule.title,
        file: rule.file,
        section: rule.section_path[0],
        benchmarks: [],
        versions: releases.map(() => null),
      })
      // fetchRuleAtRelease builds every release's path from this one file name.
      if (entry.file !== rule.file) {
        throw new Error(`Rule ${rule.id} is stored as ${entry.file} in an earlier release and as ${rule.file} in ${release.tag}; the release history needs one file name`)
      }
      // Later releases overwrite, so the entry ends up describing the latest release that has the rule.
      entry.title = rule.title
      entry.section = rule.section_path[0]
      entry.benchmarks = benchmarkNamesOf(rule)
      entry.versions[releasePosition] = kindFingerprints(rule)
    }
  })
  return { schema_version: HISTORY_INDEX_SCHEMA_VERSION, source: source.name, releases, rules }
}

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string'
}

function isFingerprints(value: unknown): boolean {
  return isObject(value) && CHANGE_KINDS.every((kind) => isText(value[kind]))
}

function isRelease(value: unknown): boolean {
  return isObject(value) && ['tag', 'label', 'published_date', 'index_path'].every((key) => isText(value[key]))
}

function ruleProblem(ruleId: string, entry: unknown, releaseCount: number): string | null {
  if (!isObject(entry)) return `rule ${ruleId} must be an object`
  if (!['title', 'file', 'section'].every((key) => isText(entry[key]))) return `rule ${ruleId} needs a title, file and section`
  if (!Array.isArray(entry.benchmarks) || !entry.benchmarks.every(isText)) return `rule ${ruleId} needs a list of benchmark names`
  if (!Array.isArray(entry.versions) || entry.versions.length !== releaseCount) {
    return `rule ${ruleId} needs one version per release (${releaseCount})`
  }
  if (!entry.versions.every((version) => version === null || isFingerprints(version))) return `rule ${ruleId} has a malformed version`
  return null
}

export function parseHistoryIndex(value: unknown): HistoryIndex | { error: string } {
  if (!isObject(value) || value.schema_version !== HISTORY_INDEX_SCHEMA_VERSION) {
    return { error: `schema_version must be ${HISTORY_INDEX_SCHEMA_VERSION}` }
  }
  if (!isText(value.source) || !Array.isArray(value.releases) || !value.releases.every(isRelease) || !isObject(value.rules)) {
    return { error: 'it needs a source, a list of releases and a rules object' }
  }
  for (const [ruleId, entry] of Object.entries(value.rules)) {
    const problem = ruleProblem(ruleId, entry, value.releases.length)
    if (problem !== null) return { error: problem }
  }
  return value as unknown as HistoryIndex
}

export interface RuleComparison {
  id: string
  title: string
  section: string
  benchmarks: string[]
  kinds: ChangeKind[]
}

export interface ReleaseComparison {
  added: RuleComparison[]
  removed: RuleComparison[]
  changed: RuleComparison[]
  unchangedCount: number
}

function releasePositionOf(index: HistoryIndex, tag: string): number {
  const position = index.releases.findIndex((release) => release.tag === tag)
  if (position === -1) throw new Error(`Release ${tag} is not in the history of ${index.source}`)
  return position
}

function differingKinds(before: KindFingerprints, after: KindFingerprints): ChangeKind[] {
  return CHANGE_KINDS.filter((kind) => before[kind] !== after[kind])
}

export function compareReleases(index: HistoryIndex, fromTag: string, toTag: string): ReleaseComparison {
  const fromPosition = releasePositionOf(index, fromTag)
  const toPosition = releasePositionOf(index, toTag)
  if (fromPosition >= toPosition) throw new Error(`Release ${fromTag} must be before ${toTag} to compare them`)
  const comparison: ReleaseComparison = { added: [], removed: [], changed: [], unchangedCount: 0 }
  for (const [id, entry] of Object.entries(index.rules)) {
    const before = entry.versions[fromPosition]
    const after = entry.versions[toPosition]
    if (before === null && after === null) continue
    const summary = { id, title: entry.title, section: entry.section, benchmarks: entry.benchmarks }
    if (before === null) comparison.added.push({ ...summary, kinds: [] })
    else if (after === null) comparison.removed.push({ ...summary, kinds: [] })
    else {
      const kinds = differingKinds(before, after)
      if (kinds.length === 0) comparison.unchangedCount += 1
      else comparison.changed.push({ ...summary, kinds })
    }
  }
  for (const group of [comparison.added, comparison.removed, comparison.changed]) {
    group.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  }
  return comparison
}

export type TimelineState = 'earliest' | 'added' | 'changed' | 'unchanged' | 'removed' | 'absent'

export interface TimelineEntry {
  tag: string
  label: string
  state: TimelineState
  kinds: ChangeKind[]
}

// Newest release first. A gap (removed, then added again) is shown as
// "removed" and "added", never as "unchanged".
export function ruleTimeline(index: HistoryIndex, ruleId: string): TimelineEntry[] {
  const entry = index.rules[ruleId]
  if (entry === undefined) return []
  const timeline = index.releases.map((release, position): TimelineEntry => {
    const current = entry.versions[position]
    const previous = position === 0 ? null : entry.versions[position - 1]
    const base = { tag: release.tag, label: release.label }
    if (current === null) return { ...base, state: previous === null ? 'absent' : 'removed', kinds: [] }
    if (position === 0) return { ...base, state: 'earliest', kinds: [] }
    if (previous === null) return { ...base, state: 'added', kinds: [] }
    const kinds = differingKinds(previous, current)
    return { ...base, state: kinds.length === 0 ? 'unchanged' : 'changed', kinds }
  })
  return timeline.reverse()
}

export type TimelineItem = { type: 'entry'; entry: TimelineEntry } | { type: 'quiet'; entries: TimelineEntry[] }

export function foldQuietRuns(entries: TimelineEntry[]): TimelineItem[] {
  const items: TimelineItem[] = []
  for (const entry of entries) {
    const last = items[items.length - 1]
    const isQuiet = entry.state === 'unchanged' || entry.state === 'absent'
    if (isQuiet && last?.type === 'quiet' && last.entries[0].state === entry.state) last.entries.push(entry)
    else if (isQuiet) items.push({ type: 'quiet', entries: [entry] })
    else items.push({ type: 'entry', entry })
  }
  return items
}

export function changeCount(entries: TimelineEntry[]): number {
  return entries.filter((entry) => entry.state === 'added' || entry.state === 'changed' || entry.state === 'removed').length
}

// The closest earlier release that has the rule, skipping a gap; null for the
// first release of the rule, or an unknown rule or release.
export function previousTagWithRule(index: HistoryIndex, ruleId: string, tag: string): string | null {
  const entry = index.rules[ruleId]
  const position = index.releases.findIndex((release) => release.tag === tag)
  if (entry === undefined || position === -1) return null
  for (let earlier = position - 1; earlier >= 0; earlier -= 1) {
    if (entry.versions[earlier] !== null) return index.releases[earlier].tag
  }
  return null
}

// The newest release that has the rule: for a rule dropped from the current
// release, the last one it was in.
export function latestReleaseWithRule(index: HistoryIndex, ruleId: string): HistoryRelease | null {
  const entry = index.rules[ruleId]
  if (entry === undefined) return null
  for (let position = index.releases.length - 1; position >= 0; position -= 1) {
    if (entry.versions[position] !== null) return index.releases[position]
  }
  return null
}

// Where a release stored the rule, relative to baselines/ (the same form a
// RuleRef path has); null when that release does not have the rule.
export function ruleFilePathAtRelease(index: HistoryIndex, ruleId: string, tag: string): string | null {
  const entry = index.rules[ruleId]
  const position = index.releases.findIndex((release) => release.tag === tag)
  if (entry === undefined || position === -1 || entry.versions[position] === null) return null
  const indexPath = index.releases[position].index_path
  return `${indexPath.slice(0, indexPath.lastIndexOf('/') + 1)}${entry.file}`
}
