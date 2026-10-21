import type { Rule } from '../types/library'
import type { RuleRow } from '../types/rule-row'
import { odvSubstitutionMode, prepareOdvValue } from './odv'
import { refKey, type OrgDefinedValue, type RuleRef, type SelectionEntry, type SelectionMap } from './selectionEntry'

export const SETTINGS_SCHEMA_VERSION = 2

// A rule is referenced by identity only, never by embedding its content, so
// exporting never duplicates anything already in the repo. libraryReleases
// records which library release the selections were made against.
export interface SettingsFileV2 {
  schemaVersion: 2
  generatedAt: string
  libraryReleases: Record<string, string>
  selections: SelectionEntry[]
}

export function buildSettingsFile(
  selections: SelectionMap,
  generatedAt: string,
  libraryReleases: Record<string, string>,
): SettingsFileV2 {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    generatedAt,
    libraryReleases,
    selections: Object.values(selections),
  }
}

export function serializeSettingsFile(file: SettingsFileV2): string {
  return JSON.stringify(file, null, 2)
}

function isRuleRef(value: unknown): value is RuleRef {
  if (typeof value !== 'object' || value === null) return false
  const ref = value as Record<string, unknown>
  return typeof ref.id === 'string' && typeof ref.path === 'string'
}

function isOrgDefinedValue(value: unknown): value is OrgDefinedValue {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

function isSelectionEntry(value: unknown): value is SelectionEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  if (!isRuleRef(entry.ref)) return false
  if (typeof entry.enabled !== 'boolean') return false
  return entry.odvValue === null || isOrgDefinedValue(entry.odvValue)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every((entry) => typeof entry === 'string')
}

export type SettingsFileValidation = { valid: true; file: SettingsFileV2 } | { valid: false; error: string }

// Validates untrusted, user-uploaded JSON before it ever touches the
// selection store - a malformed or hand-edited file must be rejected with
// a clear reason, not crash the app or silently corrupt state.
export function validateSettingsFile(raw: unknown): SettingsFileValidation {
  if (typeof raw !== 'object' || raw === null) {
    return { valid: false, error: 'That file is not a valid settings JSON object.' }
  }
  const candidate = raw as Record<string, unknown>

  if (candidate.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
    return { valid: false, error: `Unsupported settings schema version: ${JSON.stringify(candidate.schemaVersion)}.` }
  }
  if (typeof candidate.generatedAt !== 'string') {
    return { valid: false, error: 'Settings file is missing its generatedAt timestamp.' }
  }
  if (!isStringRecord(candidate.libraryReleases)) {
    return { valid: false, error: "Settings file's libraryReleases is missing or malformed." }
  }
  if (!Array.isArray(candidate.selections) || !candidate.selections.every(isSelectionEntry)) {
    return { valid: false, error: "Settings file's selections list is missing or malformed." }
  }

  return {
    valid: true,
    file: {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      generatedAt: candidate.generatedAt,
      libraryReleases: candidate.libraryReleases,
      selections: candidate.selections,
    },
  }
}

export interface ImportResolution {
  selections: SelectionMap
  unresolvedRefs: RuleRef[]
}

// Splits an imported file's selections into ones that still match a
// currently-loaded rule and ones that don't (a rule renamed/removed since
// export) - the latter are reported to the admin rather than silently
// dropped, per the settings-import contract.
export function resolveImportedSelections(file: SettingsFileV2, knownIds: ReadonlySet<string>): ImportResolution {
  const selections: SelectionMap = {}
  const unresolvedRefs: RuleRef[] = []

  for (const entry of file.selections) {
    const key = refKey(entry.ref)
    if (knownIds.has(key)) {
      selections[key] = entry
    } else {
      unresolvedRefs.push(entry.ref)
    }
  }

  return { selections, unresolvedRefs }
}

export interface DroppedImportValue {
  id: string
  reason: string
}

export interface ImportSanitization {
  selections: SelectionMap
  unknownIds: string[]
  duplicateIds: string[]
  droppedValues: DroppedImportValue[]
}

// Ids whose rule details must be fetched before sanitizing, because the
// entry carries an organization-defined value that has to be validated.
export function importedIdsWithOdvValues(
  entries: readonly SelectionEntry[],
  rowsById: ReadonlyMap<string, RuleRow>,
): string[] {
  const ids = new Set<string>()
  for (const entry of entries) {
    if (entry.odvValue !== null && rowsById.has(entry.ref.id)) ids.add(entry.ref.id)
  }
  return Array.from(ids)
}

function sanitizeOdvValue(
  id: string,
  value: OrgDefinedValue | null,
  rule: Rule | undefined,
): { odvValue: OrgDefinedValue | null; dropped: DroppedImportValue | null } {
  if (value === null) return { odvValue: null, dropped: null }
  if (!rule) return { odvValue: null, dropped: { id, reason: 'The rule details could not be loaded.' } }
  if (!rule.odv) return { odvValue: null, dropped: { id, reason: 'This rule has no organization-defined value.' } }

  const preparation = prepareOdvValue(rule.odv, value, odvSubstitutionMode(rule), rule.id)
  if (!preparation.valid) return { odvValue: null, dropped: { id, reason: preparation.error } }
  return { odvValue: preparation.value, dropped: null }
}

// A settings file is untrusted input: only the rule id is taken from it to
// find the loaded library row, the ref (and so the fetch path) is rebuilt
// from that row, and every organization-defined value is re-validated
// against the rule exactly as if the admin had typed it.
export function sanitizeImportedSelections(
  entries: readonly SelectionEntry[],
  rowsById: ReadonlyMap<string, RuleRow>,
  rulesById: ReadonlyMap<string, Rule>,
): ImportSanitization {
  const lastEntryById = new Map<string, { row: RuleRow; entry: SelectionEntry }>()
  const duplicateIds = new Set<string>()
  const unknownIds = new Set<string>()

  for (const entry of entries) {
    const id = entry.ref.id
    const row = rowsById.get(id)
    if (!row) {
      unknownIds.add(id)
      continue
    }
    if (lastEntryById.has(id)) duplicateIds.add(id)
    lastEntryById.set(id, { row, entry })
  }

  const selections: SelectionMap = {}
  const droppedValues: DroppedImportValue[] = []
  for (const [id, { row, entry }] of lastEntryById) {
    const { odvValue, dropped } = sanitizeOdvValue(id, entry.odvValue, rulesById.get(id))
    if (dropped) droppedValues.push(dropped)
    selections[refKey(row.ref)] = { ref: { id: row.ref.id, path: row.ref.path }, enabled: entry.enabled, odvValue }
  }

  return { selections, unknownIds: Array.from(unknownIds), duplicateIds: Array.from(duplicateIds), droppedValues }
}
