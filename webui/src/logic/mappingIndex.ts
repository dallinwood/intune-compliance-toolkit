// Rule mappings (docs/plans/2026-10-27-rule-mappings-design.md) are
// hand-written files under baselines/_mappings/rules/. The publish step
// (scripts/copy-baselines.mjs) turns them into one by-rule index,
// _mappings/_index.json, so the app can show a rule's links from either side
// with a single startup fetch. tools/mappings.py is the CI gate; this side
// only checks structure, skipping what it cannot use.

import { compareText } from './catalogIndex'
import type { HistoryIndex } from './historyIndex'
import { CHANGE_KINDS, type ChangeKind } from './ruleChanges'

export const MAPPING_INDEX_SCHEMA_VERSION = 1

export const MAPPING_RELATIONS = ['supports', 'related'] as const
export type MappingRelation = (typeof MAPPING_RELATIONS)[number]
// outgoing: this rule is `from`; incoming: this rule is `to`; related has no direction.
export type MappingDirection = 'outgoing' | 'incoming' | 'related'

export interface MappingIndexEntry {
  rule: string
  relation: MappingRelation
  direction: MappingDirection
  mapping: string
  note: string | null
  // The release the other rule was checked against.
  release: string
  // The release this rule was checked against.
  self_release: string
  // Written at publish time (addChangedKinds), only for an end whose release is
  // not the current one: the kinds of change since that release, [] when the
  // rule is unchanged, null when the release is not in the rule's history.
  changed_kinds?: ChangeKind[] | null
  self_changed_kinds?: ChangeKind[] | null
}

export interface MappingFileInfo {
  description: string | null
  generatedBy: string | null
}

export interface MappingIndexFile {
  schema_version: typeof MAPPING_INDEX_SCHEMA_VERSION
  by_rule: Record<string, MappingIndexEntry[]>
  // Per mapping file id, so the app can say where a link comes from. Optional:
  // an older published index has none.
  mapping_files?: Record<string, { description: string | null; generated_by: string | null }>
}

interface MappingEndpoint {
  kind: 'rule'
  id: string
  release: string
}

interface MappingLink {
  relation: MappingRelation
  from: MappingEndpoint[]
  to: MappingEndpoint[]
  note: string | null
}

interface MappingFile {
  id: string
  description: string | null
  generatedBy: string | null
  links: MappingLink[]
}

type JsonObject = Record<string, unknown>

const MAPPING_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const MAPPING_KEYS = new Set(['schema_version', 'id', 'description', 'generated_by', 'links'])
const LINK_KEYS = new Set(['relation', 'from', 'to', 'note'])
const ENDPOINT_KEYS = ['id', 'kind', 'release']
const DIRECTIONS: readonly MappingDirection[] = ['outgoing', 'incoming', 'related']

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function isRelation(value: unknown): value is MappingRelation {
  return typeof value === 'string' && (MAPPING_RELATIONS as readonly string[]).includes(value)
}

function unknownKeys(value: JsonObject, allowed: ReadonlySet<string>): string[] {
  return Object.keys(value).filter((key) => !allowed.has(key))
}

function isEndpoint(value: unknown): value is MappingEndpoint {
  return (
    isObject(value) &&
    Object.keys(value).sort().join(',') === ENDPOINT_KEYS.join(',') &&
    value.kind === 'rule' &&
    isText(value.id) &&
    isText(value.release)
  )
}

function linkProblem(link: unknown, position: number): string | null {
  const where = `links[${position}]`
  if (!isObject(link)) return `${where} must be an object`
  const unexpected = unknownKeys(link, LINK_KEYS)
  if (unexpected.length > 0) return `${where} has unexpected key(s): ${unexpected.join(', ')}`
  if (!isRelation(link.relation)) return `${where} has an unknown relation`
  for (const side of ['from', 'to'] as const) {
    const endpoints = link[side]
    if (!Array.isArray(endpoints) || endpoints.length === 0) return `${where}.${side} must be a non-empty list`
    if (!endpoints.every(isEndpoint)) return `${where}.${side} must list objects with exactly kind "rule", an id and a release`
  }
  if (link.note !== undefined && link.note !== null && typeof link.note !== 'string') return `${where}.note must be a string or null`
  return null
}

export function parseMappingFile(value: unknown, fileName: string): { mapping: MappingFile } | { error: string } {
  if (!isObject(value)) return { error: `${fileName}: a mapping file must be a JSON object` }
  const unexpected = unknownKeys(value, MAPPING_KEYS)
  if (unexpected.length > 0) return { error: `${fileName}: unexpected key(s): ${unexpected.join(', ')}` }
  if (value.schema_version !== MAPPING_INDEX_SCHEMA_VERSION) return { error: `${fileName}: schema_version must be 1` }
  if (typeof value.id !== 'string' || !MAPPING_ID_PATTERN.test(value.id)) return { error: `${fileName}: id must match ^[a-z0-9][a-z0-9-]*$` }
  if (value.description !== undefined && typeof value.description !== 'string') return { error: `${fileName}: description must be a string` }
  if (value.generated_by !== undefined && !isText(value.generated_by)) return { error: `${fileName}: generated_by must be a non-empty string` }
  if (!Array.isArray(value.links) || value.links.length === 0) return { error: `${fileName}: links must be a non-empty list` }
  for (const [position, link] of value.links.entries()) {
    const problem = linkProblem(link, position)
    if (problem !== null) return { error: `${fileName}: ${problem}` }
  }
  const links = (value.links as JsonObject[]).map(
    (link): MappingLink => ({
      relation: link.relation as MappingRelation,
      from: link.from as MappingEndpoint[],
      to: link.to as MappingEndpoint[],
      note: typeof link.note === 'string' ? link.note : null,
    }),
  )
  return {
    mapping: {
      id: value.id,
      description: typeof value.description === 'string' ? value.description : null,
      generatedBy: typeof value.generated_by === 'string' ? value.generated_by : null,
      links,
    },
  }
}

export function compareMappingEntries(left: MappingIndexEntry, right: MappingIndexEntry): number {
  return (
    compareText(left.relation, right.relation) ||
    compareText(left.rule, right.rule) ||
    DIRECTIONS.indexOf(left.direction) - DIRECTIONS.indexOf(right.direction) ||
    compareText(left.mapping, right.mapping)
  )
}

function pairKey(firstRule: string, secondRule: string): string {
  return [firstRule, secondRule].sort(compareText).join('\n')
}

// `files` must be sorted by file name. A structurally invalid file, or one
// that reuses an earlier file's id, is skipped and reported through `log`; so
// is a self-link or a pair an earlier link already defined (the first wins).
export function buildMappingIndex(files: { fileName: string; value: unknown }[], log: (message: string) => void): MappingIndexFile {
  const byRule: Record<string, MappingIndexEntry[]> = {}
  const fileById = new Map<string, string>()
  const infoById: Record<string, { description: string | null; generated_by: string | null }> = {}
  const definedPairs = new Set<string>()

  function add(ruleId: string, entry: MappingIndexEntry) {
    byRule[ruleId] = [...(byRule[ruleId] ?? []), entry]
  }

  for (const { fileName, value } of files) {
    const parsed = parseMappingFile(value, fileName)
    if ('error' in parsed) {
      log(`${parsed.error}. It was skipped.`)
      continue
    }
    const { mapping } = parsed
    const earlierFile = fileById.get(mapping.id)
    if (earlierFile !== undefined) {
      log(`${fileName}: id ${mapping.id} is already used by ${earlierFile}. It was skipped.`)
      continue
    }
    fileById.set(mapping.id, fileName)
    infoById[mapping.id] = { description: mapping.description, generated_by: mapping.generatedBy }
    for (const link of mapping.links) {
      for (const from of link.from) {
        for (const to of link.to) {
          if (from.id === to.id) {
            log(`${fileName}: rule ${from.id} is linked to itself. The link was skipped.`)
            continue
          }
          const key = pairKey(from.id, to.id)
          if (definedPairs.has(key)) {
            log(`${fileName}: the pair ${from.id} -> ${to.id} is already defined. The link was skipped.`)
            continue
          }
          definedPairs.add(key)
          const isRelated = link.relation === 'related'
          // Keys in the design's order, so the published file reads like it.
          add(from.id, {
            rule: to.id,
            relation: link.relation,
            direction: isRelated ? 'related' : 'outgoing',
            mapping: mapping.id,
            note: link.note,
            release: to.release,
            self_release: from.release,
          })
          add(to.id, {
            rule: from.id,
            relation: link.relation,
            direction: isRelated ? 'related' : 'incoming',
            mapping: mapping.id,
            note: link.note,
            release: from.release,
            self_release: to.release,
          })
        }
      }
    }
  }

  const sortedByRule: Record<string, MappingIndexEntry[]> = {}
  for (const ruleId of Object.keys(byRule).sort(compareText)) {
    sortedByRule[ruleId] = [...byRule[ruleId]].sort(compareMappingEntries)
  }
  const sortedInfo: Record<string, { description: string | null; generated_by: string | null }> = {}
  for (const mappingId of Object.keys(infoById).sort(compareText)) sortedInfo[mappingId] = infoById[mappingId]
  return { schema_version: MAPPING_INDEX_SCHEMA_VERSION, by_rule: sortedByRule, mapping_files: sortedInfo }
}

export interface MappedRule {
  rule: string
  relation: MappingRelation
  direction: MappingDirection
  mapping: string
  note: string | null
  release: string
  selfRelease: string
  // See MappingIndexEntry; a missing value is read as "not known".
  changedKinds?: ChangeKind[] | null
  selfChangedKinds?: ChangeKind[] | null
}

function isKindList(value: unknown): value is ChangeKind[] {
  return Array.isArray(value) && value.every((kind) => (CHANGE_KINDS as readonly unknown[]).includes(kind))
}

function directionFits(relation: MappingRelation, direction: unknown): direction is MappingDirection {
  if (relation === 'related') return direction === 'related'
  return direction === 'outgoing' || direction === 'incoming'
}

function parseEntry(entry: unknown): MappedRule | string {
  if (!isObject(entry)) return 'an entry must be an object'
  if (!isText(entry.rule)) return 'rule must be a non-empty string'
  if (!isRelation(entry.relation)) return 'relation is unknown'
  if (!directionFits(entry.relation, entry.direction)) return 'direction does not fit the relation'
  if (!isText(entry.mapping)) return 'mapping must be a non-empty string'
  if (entry.note !== null && typeof entry.note !== 'string') return 'note must be a string or null'
  if (!isText(entry.release) || !isText(entry.self_release)) return 'release and self_release must be non-empty strings'
  for (const key of ['changed_kinds', 'self_changed_kinds'] as const) {
    if (entry[key] !== undefined && entry[key] !== null && !isKindList(entry[key])) return `${key} must be a list of change kinds or null`
  }
  return {
    rule: entry.rule,
    relation: entry.relation,
    direction: entry.direction,
    mapping: entry.mapping,
    note: entry.note,
    release: entry.release,
    selfRelease: entry.self_release,
    ...(entry.changed_kinds === undefined ? {} : { changedKinds: entry.changed_kinds as ChangeKind[] | null }),
    ...(entry.self_changed_kinds === undefined ? {} : { selfChangedKinds: entry.self_changed_kinds as ChangeKind[] | null }),
  }
}

export interface ParsedMappingIndex {
  byRule: Map<string, MappedRule[]>
  mappingFiles: Map<string, MappingFileInfo>
  warnings: string[]
}

function parseMappingFiles(value: unknown, warnings: string[]): Map<string, MappingFileInfo> {
  const mappingFiles = new Map<string, MappingFileInfo>()
  if (value === undefined) return mappingFiles
  if (!isObject(value)) {
    warnings.push('Mapping index: mapping_files must be an object. It was skipped.')
    return mappingFiles
  }
  for (const [mappingId, info] of Object.entries(value)) {
    const isNullableText = (field: unknown) => field === null || typeof field === 'string'
    if (!isObject(info) || !isNullableText(info.description) || !isNullableText(info.generated_by)) {
      warnings.push(`Mapping index file entry for ${mappingId}: it must have a description and generated_by, each a string or null. It was skipped.`)
      continue
    }
    mappingFiles.set(mappingId, { description: info.description as string | null, generatedBy: info.generated_by as string | null })
  }
  return mappingFiles
}

// A bad entry is dropped with a warning so one bad line cannot hide the
// rest. Returns a string only when the file as a whole is unusable.
export function parseMappingIndex(value: unknown): ParsedMappingIndex | string {
  if (!isObject(value) || value.schema_version !== MAPPING_INDEX_SCHEMA_VERSION) return `schema_version must be ${MAPPING_INDEX_SCHEMA_VERSION}`
  if (!isObject(value.by_rule)) return 'it needs a by_rule object'
  const byRule = new Map<string, MappedRule[]>()
  const warnings: string[] = []
  for (const [ruleId, entries] of Object.entries(value.by_rule)) {
    if (!Array.isArray(entries)) {
      warnings.push(`Mapping index entry for ${ruleId}: it must be a list. It was skipped.`)
      continue
    }
    const parsedEntries: MappedRule[] = []
    for (const entry of entries) {
      const parsed = parseEntry(entry)
      if (typeof parsed === 'string') warnings.push(`Mapping index entry for ${ruleId}: ${parsed}. It was skipped.`)
      else parsedEntries.push(parsed)
    }
    if (parsedEntries.length > 0) byRule.set(ruleId, parsedEntries)
  }
  return { byRule, mappingFiles: parseMappingFiles(value.mapping_files, warnings), warnings }
}

// Entries for rules the loaded library does not have, on either side, are
// dropped without a warning: the index is built before the library is known.
export function linksWithinLibrary(byRule: ReadonlyMap<string, MappedRule[]>, knownRuleIds: ReadonlySet<string>): Map<string, MappedRule[]> {
  const kept = new Map<string, MappedRule[]>()
  for (const [ruleId, links] of byRule) {
    if (!knownRuleIds.has(ruleId)) continue
    const known = links.filter((link) => knownRuleIds.has(link.rule))
    if (known.length > 0) kept.set(ruleId, known)
  }
  return kept
}

// Wording from this rule's side, in display order.
const GROUP_LABELS: readonly { relation: MappingRelation; direction: MappingDirection; label: string }[] = [
  { relation: 'supports', direction: 'outgoing', label: 'Supports' },
  { relation: 'supports', direction: 'incoming', label: 'Supported by' },
  { relation: 'related', direction: 'related', label: 'Related' },
]

export function mappingGroupLabel(relation: MappingRelation, direction: MappingDirection): string {
  const group = GROUP_LABELS.find((candidate) => candidate.relation === relation && candidate.direction === direction)
  if (!group) throw new Error(`No wording for ${relation} ${direction}`)
  return group.label
}

export interface StaleEndpoint {
  ruleId: string
  sourceName: string
  mappedRelease: string
  currentRelease: string
  // What changed since the mapped release; null when that release is not in the rule's history.
  changedKinds: ChangeKind[] | null
}

// Both ends are checked, so a link checked against an older release of
// either rule shows the same note from both sides. An end whose rule did not
// change since its mapped release is not stale: nothing for the maintainer to
// review.
export function staleEndpoints(
  link: MappedRule,
  self: { ruleId: string; sourceName: string; releaseTag: string },
  other: { sourceName: string; releaseTag: string },
  changedKindsFor: (ruleId: string, mappedRelease: string) => ChangeKind[] | null,
): StaleEndpoint[] {
  const candidates = [
    { ruleId: self.ruleId, sourceName: self.sourceName, mappedRelease: link.selfRelease, currentRelease: self.releaseTag },
    { ruleId: link.rule, sourceName: other.sourceName, mappedRelease: link.release, currentRelease: other.releaseTag },
  ]
  const stale: StaleEndpoint[] = []
  for (const candidate of candidates) {
    if (candidate.mappedRelease === candidate.currentRelease) continue
    const changedKinds = changedKindsFor(candidate.ruleId, candidate.mappedRelease)
    if (changedKinds !== null && changedKinds.length === 0) continue
    stale.push({ ...candidate, changedKinds })
  }
  return stale
}

// The kinds of change between a rule's release in a mapping and the newest
// release, from the history fingerprints. null: the release is not in the
// history, or the rule is missing from it or from the newest release.
export function changedKindsSince(history: HistoryIndex, ruleId: string, mappedRelease: string): ChangeKind[] | null {
  const mappedPosition = history.releases.findIndex((release) => release.tag === mappedRelease)
  const entry = history.rules[ruleId]
  if (mappedPosition === -1 || entry === undefined) return null
  const before = entry.versions[mappedPosition]
  const after = entry.versions[history.releases.length - 1]
  if (before === null || after === null) return null
  return CHANGE_KINDS.filter((kind) => before[kind] !== after[kind])
}

// Publish-time step: notes on each entry what changed in the rule behind each
// end that is not on its current release, so the app needs no history fetch
// to draw the review note.
export function addChangedKinds(index: MappingIndexFile, histories: readonly HistoryIndex[]): MappingIndexFile {
  const historyByRule = new Map<string, HistoryIndex>()
  for (const history of histories) {
    for (const ruleId of Object.keys(history.rules)) historyByRule.set(ruleId, history)
  }
  const currentTagOf = (history: HistoryIndex) => history.releases[history.releases.length - 1].tag

  const byRule: Record<string, MappingIndexEntry[]> = {}
  for (const [ruleId, entries] of Object.entries(index.by_rule)) {
    byRule[ruleId] = entries.map((entry) => {
      const selfHistory = historyByRule.get(ruleId)
      const otherHistory = historyByRule.get(entry.rule)
      return {
        ...entry,
        ...(otherHistory !== undefined && entry.release !== currentTagOf(otherHistory)
          ? { changed_kinds: changedKindsSince(otherHistory, entry.rule, entry.release) }
          : {}),
        ...(selfHistory !== undefined && entry.self_release !== currentTagOf(selfHistory)
          ? { self_changed_kinds: changedKindsSince(selfHistory, ruleId, entry.self_release) }
          : {}),
      }
    })
  }
  return { ...index, by_rule: byRule }
}
