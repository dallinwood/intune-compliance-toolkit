import { INDEX_OVERLAY_FIELDS, parseOverlay, type Overlay, type OverlayTarget } from './overlays'

// The overlay index is generated at publish time (scripts/copy-baselines.mjs)
// as _overlays/_index.json, so the app can show overlaid titles, tags and
// filters without fetching every overlay file or every targeted rule at
// startup. It carries, per overlay, only the fields an index entry holds;
// the full overlay file is fetched when one of its target rules is opened.

export const OVERLAY_INDEX_SCHEMA_VERSION = 1

export interface IndexedOverlay {
  id: string
  // Relative to baselines/_overlays/, for example rules/example.json.
  file: string
  targets: OverlayTarget[]
  indexFields: Record<string, unknown>
}

export interface OverlayIndexFile {
  schema_version: typeof OVERLAY_INDEX_SCHEMA_VERSION
  overlays: { id: string; file: string; targets: OverlayTarget[]; index_fields: Record<string, unknown> }[]
  by_rule: Record<string, string[]>
}

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// has_odv is the only thing an index entry knows about odv, and the merge
// also needs which top-level keys an overlay supplies (a rule without an odv
// must get a complete one). So odv keeps its wrapper and its top-level keys,
// with every value replaced by true, and $replace: null stays as it is.
function keysOnly(value: unknown): unknown {
  if (!isObject(value)) return value
  return Object.fromEntries(Object.keys(value).map((key) => [key, true]))
}

export function reduceOdv(value: unknown): unknown {
  if (!isObject(value)) return value
  const keys = Object.keys(value)
  if (keys.length === 1 && (keys[0] === '$replace' || keys[0] === '$merge')) {
    return { [keys[0]]: keysOnly(value[keys[0]]) }
  }
  return keysOnly(value)
}

export function indexFieldsOf(fields: Record<string, unknown>): Record<string, unknown> {
  const indexFields: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(fields)) {
    if (INDEX_OVERLAY_FIELDS.has(name)) indexFields[name] = name === 'odv' ? reduceOdv(value) : value
  }
  return indexFields
}

// `files` must already be in apply order (sorted by file name). A file that
// is not a structurally valid overlay, or reuses an earlier overlay's id, is
// skipped and reported through `log`; full validation is CI's job.
export function buildOverlayIndex(files: { fileName: string; value: unknown }[], log: (message: string) => void): OverlayIndexFile {
  const overlays: OverlayIndexFile['overlays'] = []
  const byRule: Record<string, string[]> = {}
  const fileById = new Map<string, string>()
  for (const { fileName, value } of files) {
    const parsed = parseOverlay(value, fileName)
    if ('error' in parsed) {
      log(`${parsed.error}. It was skipped.`)
      continue
    }
    const { overlay } = parsed
    const earlierFile = fileById.get(overlay.id)
    if (earlierFile !== undefined) {
      log(`${fileName}: id ${overlay.id} is already used by ${earlierFile}. It was skipped.`)
      continue
    }
    fileById.set(overlay.id, fileName)
    overlays.push({ id: overlay.id, file: `rules/${fileName}`, targets: overlay.targets, index_fields: indexFieldsOf(overlay.fields) })
    for (const ruleId of new Set(overlay.targets.map((target) => target.rule))) {
      byRule[ruleId] = [...(byRule[ruleId] ?? []), overlay.id]
    }
  }
  return { schema_version: OVERLAY_INDEX_SCHEMA_VERSION, overlays, by_rule: byRule }
}

const OVERLAY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const OVERLAY_FILE_PATTERN = /^rules\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.json$/

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function isTarget(value: unknown): value is OverlayTarget {
  return isObject(value) && Object.keys(value).length === 2 && isText(value.rule) && isText(value.release)
}

export interface ParsedOverlayIndex {
  overlays: IndexedOverlay[]
  byRule: Map<string, string[]>
  warnings: string[]
}

function entryProblem(entry: unknown): string | null {
  if (!isObject(entry)) return 'an entry must be an object'
  if (typeof entry.id !== 'string' || !OVERLAY_ID_PATTERN.test(entry.id)) return 'id must match ^[a-z0-9][a-z0-9-]*$'
  if (typeof entry.file !== 'string' || !OVERLAY_FILE_PATTERN.test(entry.file)) return 'file must be rules/<name>.json'
  if (!Array.isArray(entry.targets) || entry.targets.length === 0 || !entry.targets.every(isTarget)) {
    return 'targets must be a non-empty list of rule and release'
  }
  if (!isObject(entry.index_fields)) return 'index_fields must be an object'
  return null
}

// A bad entry is dropped with a warning so one bad line cannot hide the
// rest. Returns a string only when the file as a whole is unusable.
export function parseOverlayIndex(value: unknown): ParsedOverlayIndex | string {
  if (!isObject(value) || value.schema_version !== OVERLAY_INDEX_SCHEMA_VERSION) {
    return `schema_version must be ${OVERLAY_INDEX_SCHEMA_VERSION}`
  }
  if (!Array.isArray(value.overlays) || !isObject(value.by_rule)) return 'it needs an overlays list and a by_rule object'

  const overlays: IndexedOverlay[] = []
  const warnings: string[] = []
  const seenIds = new Set<string>()
  for (const entry of value.overlays) {
    const problem = entryProblem(entry)
    if (problem !== null) {
      const label = isObject(entry) && typeof entry.id === 'string' ? entry.id : '?'
      warnings.push(`Overlay index entry ${label}: ${problem}. It was skipped.`)
      continue
    }
    const { id, file, targets, index_fields } = entry as {
      id: string
      file: string
      targets: OverlayTarget[]
      index_fields: Record<string, unknown>
    }
    if (seenIds.has(id)) {
      warnings.push(`Overlay index entry ${id}: the id is already used by an earlier entry. It was skipped.`)
      continue
    }
    // The same wrapper and field-kind checks as an overlay file.
    const fieldsProblem = parseOverlay({ schema_version: 1, id, targets, fields: index_fields }, file)
    if ('error' in fieldsProblem) {
      warnings.push(`Overlay index entry ${id}: ${fieldsProblem.error.replace(`${file}: `, '')}. It was skipped.`)
      continue
    }
    seenIds.add(id)
    overlays.push({ id, file, targets, indexFields: index_fields })
  }

  const known = new Set(overlays.map((overlay) => overlay.id))
  const byRule = new Map<string, string[]>()
  for (const [ruleId, ids] of Object.entries(value.by_rule)) {
    if (Array.isArray(ids)) byRule.set(ruleId, ids.filter((id): id is string => typeof id === 'string' && known.has(id)))
  }
  return { overlays, byRule, warnings }
}

// What the startup merge applies: the index-level view of each overlay.
export function indexLevelOverlays(overlays: IndexedOverlay[]): Overlay[] {
  return overlays.map((overlay) => ({ id: overlay.id, targets: overlay.targets, fields: overlay.indexFields }))
}
