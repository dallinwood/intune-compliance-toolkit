// Rule mappings (docs/plans/2026-10-27-rule-mappings-design.md) are
// hand-written files under baselines/_mappings/rules/. The publish step
// (scripts/copy-baselines.mjs) turns them into one by-rule index,
// _mappings/_index.json, so the app can show a rule's links from either side
// with a single startup fetch. tools/mappings.py is the CI gate; this side
// only checks structure, skipping what it cannot use.

export const MAPPING_INDEX_SCHEMA_VERSION = 1

export const MAPPING_RELATIONS = ['implements', 'partially_implements', 'related'] as const
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
}

export interface MappingIndexFile {
  schema_version: typeof MAPPING_INDEX_SCHEMA_VERSION
  by_rule: Record<string, MappingIndexEntry[]>
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
  links: MappingLink[]
}

type JsonObject = Record<string, unknown>

const MAPPING_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const MAPPING_KEYS = new Set(['schema_version', 'id', 'description', 'links'])
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
  return { mapping: { id: value.id, links } }
}

// Plain code-unit order, never localeCompare, so the output is byte-stable
// on every machine.
function compareText(left: string, right: string): number {
  if (left < right) return -1
  return left > right ? 1 : 0
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
  return { schema_version: MAPPING_INDEX_SCHEMA_VERSION, by_rule: sortedByRule }
}

export interface MappedRule {
  rule: string
  relation: MappingRelation
  direction: MappingDirection
  mapping: string
  note: string | null
  release: string
  selfRelease: string
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
  return {
    rule: entry.rule,
    relation: entry.relation,
    direction: entry.direction,
    mapping: entry.mapping,
    note: entry.note,
    release: entry.release,
    selfRelease: entry.self_release,
  }
}

export interface ParsedMappingIndex {
  byRule: Map<string, MappedRule[]>
  warnings: string[]
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
  return { byRule, warnings }
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
  { relation: 'implements', direction: 'outgoing', label: 'Implements' },
  { relation: 'implements', direction: 'incoming', label: 'Implemented by' },
  { relation: 'partially_implements', direction: 'outgoing', label: 'Partially implements' },
  { relation: 'partially_implements', direction: 'incoming', label: 'Partially implemented by' },
  { relation: 'related', direction: 'related', label: 'Related' },
]

export function mappingGroupLabel(relation: MappingRelation, direction: MappingDirection): string {
  const group = GROUP_LABELS.find((candidate) => candidate.relation === relation && candidate.direction === direction)
  if (!group) throw new Error(`No wording for ${relation} ${direction}`)
  return group.label
}

export interface MappingGroup {
  label: string
  links: MappedRule[]
}

// Empty groups are left out; links keep their index order (by rule id).
export function groupMappedRules(links: readonly MappedRule[]): MappingGroup[] {
  return GROUP_LABELS.map(({ relation, direction, label }) => ({
    label,
    links: links.filter((link) => link.relation === relation && link.direction === direction),
  })).filter((group) => group.links.length > 0)
}

export interface StaleEndpoint {
  ruleId: string
  sourceName: string
  mappedRelease: string
  currentRelease: string
}

// Both ends are checked, so a link checked against an older release of
// either rule shows the same note from both sides.
export function staleEndpoints(
  link: MappedRule,
  self: { ruleId: string; sourceName: string; releaseTag: string },
  other: { sourceName: string; releaseTag: string },
): StaleEndpoint[] {
  const stale: StaleEndpoint[] = []
  if (link.selfRelease !== self.releaseTag) {
    stale.push({ ruleId: self.ruleId, sourceName: self.sourceName, mappedRelease: link.selfRelease, currentRelease: self.releaseTag })
  }
  if (link.release !== other.releaseTag) {
    stale.push({ ruleId: link.rule, sourceName: other.sourceName, mappedRelease: link.release, currentRelease: other.releaseTag })
  }
  return stale
}
