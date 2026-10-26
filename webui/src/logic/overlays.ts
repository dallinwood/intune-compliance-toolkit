import type { IndexEntry, Rule } from '../types/library'
import { indexEntryShapeProblem, ruleShapeProblem } from './overlayShape'

// Maintainer-written overlays add to or replace fields on imported rules as
// they are displayed; baselines/ itself is never changed. tools/overlays.py
// carries the same merge rules for CI, and both are pinned by
// tests/fixtures/overlays/cases.json.

export interface OverlayTarget {
  rule: string
  release: string
}

export interface Overlay {
  id: string
  targets: OverlayTarget[]
  fields: Record<string, unknown>
}

export interface OverlayApplication {
  overlayId: string
  release: string
  stale: boolean
}

// Keyed by top-level rule field: the overlay that last wrote it.
export type OverlayProvenance = Map<string, OverlayApplication>

export interface SkippedOverlay {
  overlayId: string
  message: string
}

export interface OverlaidRule {
  rule: Rule
  provenance: OverlayProvenance
  applied: OverlayApplication[]
  skipped: SkippedOverlay[]
}

export type OnOverlaySkipped = (skipped: SkippedOverlay) => void

export class InvalidOverlayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidOverlayError'
  }
}

const OVERLAY_SCHEMA_VERSION = 1
const OVERLAY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const REQUIRED_OVERLAY_KEYS = ['schema_version', 'id', 'targets', 'fields']
const ALLOWED_OVERLAY_KEYS = new Set([...REQUIRED_OVERLAY_KEYS, 'description'])

export const PROTECTED_FIELDS: ReadonlySet<string> = new Set(['id', 'source', 'file', 'schema_version'])
const REPLACE = '$replace'
const APPEND = '$append'
const MERGE = '$merge'
const WRAPPER_KEYS: ReadonlySet<string> = new Set([REPLACE, APPEND, MERGE])
// Assigning these keys on a plain object would reach its prototype.
const RESERVED_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

type FieldKind = 'string' | 'list' | 'object' | 'object-or-null' | 'string-or-null'

// The v5 rule fields an overlay may set, with the value kind the rule schema
// allows. The shape of the merged result is checked in overlayShape.ts; full
// schema validation is CI's job.
export const FIELD_KINDS: Readonly<Record<string, FieldKind>> = {
  title: 'string',
  discussion: 'string',
  discussion_format: 'string',
  section_path: 'list',
  assessment: 'object',
  architecture: 'string-or-null',
  applicability: 'list',
  tags: 'list',
  references: 'object',
  check: 'object-or-null',
  odv: 'object-or-null',
  remediation: 'object-or-null',
}
export const OVERLAYABLE_RULE_FIELDS: ReadonlySet<string> = new Set(Object.keys(FIELD_KINDS))

// Index entries are copies of these rule fields (odv stands in for has_odv);
// every other overlay field only exists on the full rule and is ignored at
// index level.
export const INDEX_OVERLAY_FIELDS: ReadonlySet<string> = new Set([
  'title',
  'section_path',
  'assessment',
  'architecture',
  'applicability',
  'tags',
  'odv',
])
const ODV_REQUIRED_KEYS = ['by_benchmark', 'datatype', 'description', 'recommended', 'validation']

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const ABSENT = Symbol('absent')
type Upstream = unknown | typeof ABSENT

function kindOf(value: Upstream): string {
  if (value === ABSENT) return 'absent'
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'list'
  return typeof value === 'object' ? 'object' : typeof value
}

function reservedKeyError(value: unknown, path: string): string | null {
  if (Array.isArray(value)) {
    for (const [position, item] of value.entries()) {
      const problem = reservedKeyError(item, `${path}[${position}]`)
      if (problem) return problem
    }
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (RESERVED_KEYS.has(key)) return `${path}: key ${key} is not allowed`
      const problem = reservedKeyError(child, `${path}.${key}`)
      if (problem) return problem
    }
  }
  return null
}

function wrapperOf(value: JsonObject, path: string): [string, unknown] | null {
  const keys = Object.keys(value)
  const dollarKeys = keys.filter((key) => key.startsWith('$'))
  if (dollarKeys.length === 0) return null
  if (keys.length !== 1) {
    throw new InvalidOverlayError(`${path}: a wrapper object must have exactly one key, got ${keys.sort().join(', ')}`)
  }
  const wrapperKey = dollarKeys[0]
  if (!WRAPPER_KEYS.has(wrapperKey)) {
    throw new InvalidOverlayError(`${path}: unknown wrapper ${wrapperKey} (expected $replace, $append or $merge)`)
  }
  return [wrapperKey, value[wrapperKey]]
}

// Upstream null merges and appends as if the field were absent, so a partial
// object can fill in a field upstream left empty (such as check: null).
function append(upstream: Upstream, entries: unknown[], path: string): unknown[] {
  if (upstream === ABSENT || upstream === null) return structuredClone(entries)
  if (!Array.isArray(upstream)) throw new InvalidOverlayError(`${path}: cannot append a list to a ${kindOf(upstream)} value`)
  return [...structuredClone(upstream), ...structuredClone(entries)]
}

function mergeObject(upstream: Upstream, overlayObject: JsonObject, path: string): JsonObject {
  let merged: JsonObject
  if (upstream === ABSENT || upstream === null) {
    merged = {}
  } else if (isObject(upstream)) {
    merged = structuredClone(upstream)
  } else {
    throw new InvalidOverlayError(`${path}: cannot merge an object into a ${kindOf(upstream)} value`)
  }
  for (const [key, value] of Object.entries(overlayObject)) {
    if (key.startsWith('$')) throw new InvalidOverlayError(`${path}: key ${key} starts with $, which is reserved for wrappers`)
    merged[key] = mergeValue(Object.hasOwn(merged, key) ? merged[key] : ABSENT, value, `${path}.${key}`)
  }
  return merged
}

function mergeValue(upstream: Upstream, value: unknown, path: string): unknown {
  if (Array.isArray(value)) return append(upstream, value, path)
  if (!isObject(value)) return structuredClone(value)
  const wrapper = wrapperOf(value, path)
  if (wrapper === null) return mergeObject(upstream, value, path)
  const [wrapperKey, wrapped] = wrapper
  if (wrapperKey === REPLACE) return structuredClone(wrapped)
  if (wrapperKey === APPEND) {
    if (!Array.isArray(wrapped)) throw new InvalidOverlayError(`${path}: $append takes a list, got a ${kindOf(wrapped)}`)
    return append(upstream, wrapped, path)
  }
  if (!isObject(wrapped)) throw new InvalidOverlayError(`${path}: $merge takes an object, got a ${kindOf(wrapped)}`)
  return mergeObject(upstream, wrapped, path)
}

function protectedFieldError(fields: JsonObject): string | null {
  const protectedNames = Object.keys(fields).filter((name) => PROTECTED_FIELDS.has(name)).sort()
  return protectedNames.length > 0 ? `protected field(s) cannot be overlaid: ${protectedNames.join(', ')}` : null
}

// Pure: returns a new object and never changes its inputs. With knownFields,
// top-level fields outside it are skipped; protected and reserved keys are
// rejected either way.
export function applyOverlayFields<T>(target: T, fields: Record<string, unknown>, knownFields?: ReadonlySet<string>): T {
  const protectedError = protectedFieldError(fields)
  if (protectedError) throw new InvalidOverlayError(protectedError)
  const reservedError = reservedKeyError(fields, 'fields')
  if (reservedError) throw new InvalidOverlayError(reservedError)
  const source = target as JsonObject
  const merged = structuredClone(source)
  for (const [fieldName, value] of Object.entries(fields)) {
    if (knownFields && !knownFields.has(fieldName)) continue
    merged[fieldName] = mergeValue(Object.hasOwn(source, fieldName) ? source[fieldName] : ABSENT, value, fieldName)
  }
  return merged as T
}

// An index entry has no odv, only has_odv, so it is stood in for by an
// empty object or null. An odv the rule did not have must arrive complete,
// or has_odv would promise a value the rule cannot supply. section and
// has_odv are derived, so they are recomputed.
export function applyOverlayToIndexEntry(entry: IndexEntry, fields: Record<string, unknown>): IndexEntry {
  const seeded = { ...entry, odv: entry.has_odv ? {} : null }
  const { odv, ...merged } = applyOverlayFields(seeded, fields, INDEX_OVERLAY_FIELDS)
  if (!entry.has_odv && odv !== null) {
    const missing = ODV_REQUIRED_KEYS.filter((key) => !isObject(odv) || !Object.hasOwn(odv, key))
    if (missing.length > 0) {
      throw new InvalidOverlayError(`odv: a rule without an odv needs a complete one, missing ${missing.join(', ')}`)
    }
  }
  const sectionPath: unknown = merged.section_path
  const section = Array.isArray(sectionPath) && sectionPath.length > 0 ? sectionPath[0] : merged.section
  return { ...merged, section, has_odv: odv !== null }
}

// The UI's single-overlay steps: merge, then check the result's shape so
// nothing malformed reaches rendering or generation.
export function applyOverlayToCheckedIndexEntry(entry: IndexEntry, fields: Record<string, unknown>): IndexEntry {
  const merged = applyOverlayToIndexEntry(entry, fields)
  const problem = indexEntryShapeProblem(merged)
  if (problem) throw new InvalidOverlayError(problem)
  return merged
}

export function applyOverlayToRule(rule: Rule, fields: Record<string, unknown>): Rule {
  const merged = applyOverlayFields(rule, fields, OVERLAYABLE_RULE_FIELDS)
  const problem = ruleShapeProblem(merged)
  if (problem) throw new InvalidOverlayError(problem)
  return merged
}

export function targetFor(overlay: Overlay, ruleId: string): OverlayTarget | undefined {
  return overlay.targets.find((target) => target.rule === ruleId)
}

// Load-time checks should already have dropped an overlay that does not fit;
// one that still fails is skipped and reported rather than breaking the table.
export function applyOverlaysToIndexEntry(entry: IndexEntry, overlays: Overlay[], onSkipped?: OnOverlaySkipped): IndexEntry {
  let merged = entry
  for (const overlay of overlays) {
    if (!targetFor(overlay, entry.id)) continue
    try {
      merged = applyOverlayToCheckedIndexEntry(merged, overlay.fields)
    } catch (error) {
      if (!(error instanceof InvalidOverlayError)) throw error
      onSkipped?.({ overlayId: overlay.id, message: `${entry.id}: ${error.message}` })
    }
  }
  return merged
}

// `release` is the loaded rule's release tag; a target written against any
// other tag is stale. Tags are compared as plain strings.
export function applyOverlays(rule: Rule, overlays: Overlay[], release: string): OverlaidRule {
  const provenance: OverlayProvenance = new Map()
  const applied: OverlayApplication[] = []
  const skipped: SkippedOverlay[] = []
  let merged = rule
  for (const overlay of overlays) {
    const target = targetFor(overlay, rule.id)
    if (!target) continue
    try {
      merged = applyOverlayToRule(merged, overlay.fields)
    } catch (error) {
      if (!(error instanceof InvalidOverlayError)) throw error
      skipped.push({ overlayId: overlay.id, message: `${rule.id}: ${error.message}` })
      continue
    }
    const application = { overlayId: overlay.id, release: target.release, stale: target.release !== release }
    applied.push(application)
    for (const fieldName of Object.keys(overlay.fields)) {
      if (OVERLAYABLE_RULE_FIELDS.has(fieldName)) provenance.set(fieldName, application)
    }
  }
  return { rule: merged, provenance, applied, skipped }
}

// The kind of value an overlay leaves in its field once unwrapped: $append
// always leaves a list and $merge an object.
function effectiveKind(value: unknown): string {
  if (isObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 1 && keys[0] === REPLACE) return kindOf(value[REPLACE])
    if (keys.length === 1 && keys[0] === APPEND) return 'list'
    return 'object'
  }
  return kindOf(value)
}

function fitsKind(kind: string, fieldKind: FieldKind): boolean {
  switch (fieldKind) {
    case 'object-or-null':
      return kind === 'object' || kind === 'null'
    case 'string-or-null':
      return kind === 'string' || kind === 'null'
    default:
      return kind === fieldKind
  }
}

// Walks the overlay value the way mergeValue will, without an upstream, so a
// malformed wrapper is caught at load even for fields an index entry lacks.
function wrapperShapeError(value: unknown, path: string): string | null {
  if (!isObject(value)) return null
  try {
    const wrapper = wrapperOf(value, path)
    if (wrapper === null) return firstChildError(value, path)
    const [wrapperKey, wrapped] = wrapper
    if (wrapperKey === APPEND && !Array.isArray(wrapped)) return `${path}: $append takes a list, got a ${kindOf(wrapped)}`
    if (wrapperKey === MERGE) {
      if (!isObject(wrapped)) return `${path}: $merge takes an object, got a ${kindOf(wrapped)}`
      const reservedKey = Object.keys(wrapped).find((key) => key.startsWith('$'))
      if (reservedKey) return `${path}: key ${reservedKey} starts with $, which is reserved for wrappers`
      return firstChildError(wrapped, path)
    }
    return null
  } catch (error) {
    if (error instanceof InvalidOverlayError) return error.message
    throw error
  }
}

function firstChildError(value: JsonObject, path: string): string | null {
  for (const [key, child] of Object.entries(value)) {
    const error = wrapperShapeError(child, `${path}.${key}`)
    if (error) return error
  }
  return null
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function isTarget(value: unknown): value is OverlayTarget {
  if (!isObject(value)) return false
  const keys = Object.keys(value).sort()
  return keys.length === 2 && keys[0] === 'release' && keys[1] === 'rule' && isText(value.rule) && isText(value.release)
}

function overlayProblem(value: unknown): string | null {
  if (!isObject(value)) return 'an overlay must be a JSON object'
  const missing = REQUIRED_OVERLAY_KEYS.filter((key) => !Object.hasOwn(value, key))
  if (missing.length > 0) return `missing key(s): ${missing.join(', ')}`
  const unexpected = Object.keys(value).filter((key) => !ALLOWED_OVERLAY_KEYS.has(key))
  if (unexpected.length > 0) return `unexpected key(s): ${unexpected.join(', ')}`
  if (value.schema_version !== OVERLAY_SCHEMA_VERSION) return `schema_version must be ${OVERLAY_SCHEMA_VERSION}`
  if (typeof value.id !== 'string' || !OVERLAY_ID_PATTERN.test(value.id)) return 'id must match ^[a-z0-9][a-z0-9-]*$'
  if (Object.hasOwn(value, 'description') && typeof value.description !== 'string') return 'description must be a string'
  if (!Array.isArray(value.targets) || value.targets.length === 0) return 'targets must be a non-empty list'
  const badTarget = value.targets.findIndex((target) => !isTarget(target))
  if (badTarget !== -1) return `targets[${badTarget}] must be an object with exactly a rule and a release string`
  if (!isObject(value.fields)) return 'fields must be an object'

  const protectedError = protectedFieldError(value.fields)
  if (protectedError) return protectedError
  const reservedError = reservedKeyError(value.fields, 'fields')
  if (reservedError) return reservedError
  for (const [fieldName, fieldValue] of Object.entries(value.fields)) {
    const shapeError = wrapperShapeError(fieldValue, fieldName)
    if (shapeError) return shapeError
    const fieldKind = FIELD_KINDS[fieldName]
    if (fieldKind === undefined) continue
    const kind = effectiveKind(fieldValue)
    if (!fitsKind(kind, fieldKind)) return `${fieldName} must be a ${fieldKind.replaceAll('-', ' ')} value, got a ${kind}`
  }
  return null
}

// A hand-written check of the file shape and merge types, deliberately not a
// JSON Schema library: the full rule-schema check runs in CI.
export function parseOverlay(value: unknown, fileName: string): { overlay: Overlay } | { error: string } {
  const problem = overlayProblem(value)
  if (problem !== null) return { error: `${fileName}: ${problem}` }
  const file = value as { id: string; targets: OverlayTarget[]; fields: Record<string, unknown> }
  return {
    overlay: {
      id: file.id,
      targets: file.targets.map((target) => ({ rule: target.rule, release: target.release })),
      fields: file.fields,
    },
  }
}
