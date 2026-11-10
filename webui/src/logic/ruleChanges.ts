// What changed in a rule between two releases, on our normalised rule format
// only (never raw upstream data). Two views of the same comparison:
// fingerprints (one short hash per kind of change, for listing what changed
// across a whole framework) and fieldChanges (every changed field, for
// drawing a diff). A kind's fingerprints differ exactly when fieldChanges has
// a change of that kind.
import changeIgnoreFile from '../../../baselines/_change_ignore.json' with { type: 'json' }
import type { ApplicabilityEntry, Rule } from '../types/library'
import { versionKey } from './applicability'
import { BREADCRUMB_SEPARATOR } from './ruleDisplay'

export type ChangeKind = 'behaviour' | 'scope' | 'wording' | 'references'

export const CHANGE_KINDS: readonly ChangeKind[] = ['behaviour', 'scope', 'wording', 'references']
export const DEFAULT_SHOWN_KINDS: readonly ChangeKind[] = ['behaviour', 'scope', 'wording']

// Ignoring a field ignores everything under it. The list lives in a JSON file
// so the Python mapping check reads the very same one.
export const IGNORED_FIELDS: ReadonlySet<string> = new Set(changeIgnoreFile.ignored_fields)

export const FIELD_CHANGE_KIND: Readonly<Record<string, ChangeKind>> = {
  check: 'behaviour',
  remediation: 'behaviour',
  odv: 'behaviour',
  assessment: 'behaviour',
  architecture: 'behaviour',
  applicability: 'scope',
  title: 'wording',
  discussion: 'wording',
  discussion_format: 'wording',
  references: 'references',
  tags: 'references',
  section_path: 'references',
}

// A field nobody has classified yet is treated as behaviour, so it is shown
// by default rather than silently dropped; a test fails until it is classified.
function kindOfField(field: string): ChangeKind {
  return FIELD_CHANGE_KIND[field] ?? 'behaviour'
}

export type KindFingerprints = Record<ChangeKind, string>

export interface FieldChange {
  kind: ChangeKind
  path: string[]
  display: 'text' | 'code' | 'list' | 'value'
  before: unknown
  after: unknown
}

type PlainObject = Record<string, unknown>

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPrimitive(value: unknown): boolean {
  return value === null || typeof value !== 'object'
}

function scopeKeyOf(entry: ApplicabilityEntry): string {
  if (entry.target !== null && entry.version !== null) return versionKey(entry.target, entry.version)
  return entry.target ?? entry.version ?? 'none'
}

function benchmarkLabel(benchmark: { name: string; severity: string | null }): string {
  return benchmark.severity === null ? benchmark.name : `${benchmark.name} (${benchmark.severity})`
}

// The order of applicability entries and of the benchmarks inside one is not
// meaningful, so it is fixed before anything is compared.
function canonicalField(field: string, value: unknown): unknown {
  if (field !== 'applicability' || !Array.isArray(value)) return value
  const entries = (value as ApplicabilityEntry[]).map((entry) => ({
    ...entry,
    benchmarks: [...entry.benchmarks].sort((left, right) => benchmarkLabel(left).localeCompare(benchmarkLabel(right), 'en')),
  }))
  return entries.sort((left, right) => scopeKeyOf(left).localeCompare(scopeKeyOf(right), 'en'))
}

// A missing value and a null are the same "no value": a release that starts
// writing "additional_info": null is not a change.
function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isPlainObject(value)) {
    const members = Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined && value[key] !== null)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    return `{${members.join(',')}}`
  }
  return JSON.stringify(value)
}

// cyrb53, a small 53-bit string hash (public domain): enough to tell two
// versions of a rule apart, and nothing here depends on it being secure.
function cyrb53(text: string): number {
  let firstHalf = 0xdeadbeef
  let secondHalf = 0x41c6ce57
  for (let position = 0; position < text.length; position += 1) {
    const code = text.charCodeAt(position)
    firstHalf = Math.imul(firstHalf ^ code, 2654435761)
    secondHalf = Math.imul(secondHalf ^ code, 1597334677)
  }
  firstHalf = Math.imul(firstHalf ^ (firstHalf >>> 16), 2246822507)
  firstHalf ^= Math.imul(secondHalf ^ (secondHalf >>> 13), 3266489909)
  secondHalf = Math.imul(secondHalf ^ (secondHalf >>> 16), 2246822507)
  secondHalf ^= Math.imul(firstHalf ^ (firstHalf >>> 13), 3266489909)
  return 4294967296 * (2097151 & secondHalf) + (firstHalf >>> 0)
}

export function kindFingerprints(rule: Rule): KindFingerprints {
  const fieldsByKind: Record<ChangeKind, PlainObject> = { behaviour: {}, scope: {}, wording: {}, references: {} }
  for (const [field, value] of Object.entries(rule)) {
    if (IGNORED_FIELDS.has(field)) continue
    fieldsByKind[kindOfField(field)][field] = canonicalField(field, value)
  }
  return Object.fromEntries(CHANGE_KINDS.map((kind) => [kind, cyrb53(canonicalJson(fieldsByKind[kind])).toString(36)])) as KindFingerprints
}

const CODE_KEYS: ReadonlySet<string> = new Set(['shell', 'script'])

function leafDisplay(path: string[], before: unknown, after: unknown): FieldChange['display'] {
  if (typeof before === 'string' || typeof after === 'string') {
    return CODE_KEYS.has(path[path.length - 1]) ? 'code' : 'text'
  }
  if ((Array.isArray(before) || Array.isArray(after)) && [before, after].every((side) => side === undefined || (Array.isArray(side) && side.every(isPrimitive)))) {
    return 'list'
  }
  return 'value'
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null
}

function isPayloadData(path: string[]): boolean {
  return path[path.length - 1] === 'data' && path.includes('payloads')
}

function prettyJson(value: unknown): string | undefined {
  return value === undefined ? undefined : JSON.stringify(JSON.parse(canonicalJson(value)), null, 2)
}

function walk(kind: ChangeKind, path: string[], before: unknown, after: unknown, changes: FieldChange[]): void {
  if (canonicalJson(before) === canonicalJson(after)) return

  // The section is an ordered breadcrumb, not a set of names.
  if (path.length === 1 && path[0] === 'section_path' && Array.isArray(before) && Array.isArray(after)) {
    changes.push({ kind, path, display: 'value', before: before.join(BREADCRUMB_SEPARATOR), after: after.join(BREADCRUMB_SEPARATOR) })
    return
  }

  if (isPayloadData(path)) {
    changes.push({ kind, path, display: 'code', before: prettyJson(before), after: prettyJson(after) })
    return
  }

  // An object that appeared or disappeared is spelled out part by part (a new
  // check becomes its shell, its result, ...), so each part is drawn as the
  // kind of value it is instead of one block of JSON.
  const beforeParts = isPlainObject(before) ? before : isAbsent(before) && isPlainObject(after) ? {} : null
  const afterParts = isPlainObject(after) ? after : isAbsent(after) && isPlainObject(before) ? {} : null
  if (beforeParts !== null && afterParts !== null) {
    for (const key of [...new Set([...Object.keys(beforeParts), ...Object.keys(afterParts)])].sort()) {
      walk(kind, [...path, key], beforeParts[key], afterParts[key], changes)
    }
    return
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const lastSegment = path[path.length - 1]
    if (path.length === 1 && lastSegment === 'applicability') {
      walkApplicability(kind, path, before as ApplicabilityEntry[], after as ApplicabilityEntry[], changes)
      return
    }
    if (lastSegment === 'benchmarks') {
      const labels = (benchmarks: unknown[]) => (benchmarks as { name: string; severity: string | null }[]).map(benchmarkLabel)
      changes.push({ kind, path, display: 'list', before: labels(before), after: labels(after) })
      return
    }
    if (before.every(isPrimitive) && after.every(isPrimitive)) {
      changes.push({ kind, path, display: 'list', before, after })
      return
    }
    const length = Math.max(before.length, after.length)
    for (let position = 0; position < length; position += 1) {
      walk(kind, [...path, String(position)], before[position], after[position], changes)
    }
    return
  }

  changes.push({ kind, path, display: leafDisplay(path, before, after), before, after })
}

function walkApplicability(kind: ChangeKind, path: string[], before: ApplicabilityEntry[], after: ApplicabilityEntry[], changes: FieldChange[]): void {
  const beforeByScope = new Map(before.map((entry) => [scopeKeyOf(entry), entry]))
  const afterByScope = new Map(after.map((entry) => [scopeKeyOf(entry), entry]))
  for (const scope of [...new Set([...beforeByScope.keys(), ...afterByScope.keys()])].sort()) {
    const beforeEntry = beforeByScope.get(scope)
    const afterEntry = afterByScope.get(scope)
    // A scope that appeared or disappeared is one change, not its parts.
    if (beforeEntry === undefined || afterEntry === undefined) {
      changes.push({ kind, path: [...path, scope], display: 'value', before: beforeEntry, after: afterEntry })
    } else {
      walk(kind, [...path, scope], beforeEntry, afterEntry, changes)
    }
  }
}

function comparePaths(left: string[], right: string[]): number {
  for (let position = 0; position < Math.min(left.length, right.length); position += 1) {
    const difference = left[position].localeCompare(right[position], 'en', { numeric: true })
    if (difference !== 0) return difference
  }
  return left.length - right.length
}

export function fieldChanges(before: Rule, after: Rule): FieldChange[] {
  const beforeFields = before as unknown as PlainObject
  const afterFields = after as unknown as PlainObject
  const changes: FieldChange[] = []
  for (const field of [...new Set([...Object.keys(beforeFields), ...Object.keys(afterFields)])]) {
    if (IGNORED_FIELDS.has(field)) continue
    walk(kindOfField(field), [field], canonicalField(field, beforeFields[field]), canonicalField(field, afterFields[field]), changes)
  }
  return changes.sort(
    (left, right) => CHANGE_KINDS.indexOf(left.kind) - CHANGE_KINDS.indexOf(right.kind) || comparePaths(left.path, right.path),
  )
}
