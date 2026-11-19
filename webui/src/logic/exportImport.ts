import type { Rule } from '../types/library'
import type { RuleRow } from '../types/rule-row'
import { odvSubstitutionMode, prepareOdvValue } from './odv'
import type { SupportingCheckChoices } from './supportingChecks'
import {
  refKey,
  selectionEntryFromVersion2,
  type OdvValues,
  type OrgDefinedValue,
  type RuleRef,
  type SelectionEntry,
  type SelectionEntryVersion2,
  type SelectionMap,
} from './selectionEntry'

export const SETTINGS_SCHEMA_VERSION = 3

// A rule is referenced by identity only, never by embedding its content, so
// exporting never duplicates anything already in the repo. libraryReleases
// records which library release the selections were made against.
export interface SettingsFileV3 {
  schemaVersion: 3
  generatedAt: string
  libraryReleases: Record<string, string>
  selections: SelectionEntry[]
  // Absent in files exported before supporting checks existed.
  supportingChecks?: SupportingCheckChoices
}

export function buildSettingsFile(
  selections: SelectionMap,
  generatedAt: string,
  libraryReleases: Record<string, string>,
  supportingChecks?: SupportingCheckChoices,
): SettingsFileV3 {
  const file: SettingsFileV3 = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    generatedAt,
    libraryReleases,
    selections: Object.values(selections),
  }
  if (supportingChecks) file.supportingChecks = supportingChecks
  return file
}

export function serializeSettingsFile(file: SettingsFileV3): string {
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
  const odvValues = entry.odvValues
  if (typeof odvValues !== 'object' || odvValues === null || Array.isArray(odvValues)) return false
  return Object.values(odvValues).every(isOrgDefinedValue)
}

function isSelectionEntryVersion2(value: unknown): value is SelectionEntryVersion2 {
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

// Returns null when the value is not well-formed, so the caller can drop it
// and carry on: the selections matter more than the supporting check choices.
export function parseSupportingCheckChoices(raw: unknown): SupportingCheckChoices | null {
  if (typeof raw !== 'object' || raw === null) return null
  const candidate = raw as Record<string, unknown>
  if (typeof candidate.includeSupporting !== 'boolean') return null
  const rawOverrides = candidate.overrides
  if (typeof rawOverrides !== 'object' || rawOverrides === null || Array.isArray(rawOverrides)) return null

  const overrides: SupportingCheckChoices['overrides'] = {}
  for (const [ruleId, choice] of Object.entries(rawOverrides)) {
    if (choice !== 'include' && choice !== 'exclude') return null
    overrides[ruleId] = choice
  }
  return { includeSupporting: candidate.includeSupporting, overrides }
}

const UNREADABLE_SUPPORTING_CHECKS_WARNING = 'Supporting check choices in this file were not readable and were reset to the defaults.'

export type SettingsFileValidation =
  | { valid: true; file: SettingsFileV3; warnings: string[] }
  | { valid: false; error: string }

// Validates untrusted, user-uploaded JSON before it ever touches the
// selection store - a malformed or hand-edited file must be rejected with
// a clear reason, not crash the app or silently corrupt state.
export function validateSettingsFile(raw: unknown): SettingsFileValidation {
  if (typeof raw !== 'object' || raw === null) {
    return { valid: false, error: 'That file is not a valid settings JSON object.' }
  }
  const candidate = raw as Record<string, unknown>

  const isVersion2 = candidate.schemaVersion === 2
  if (candidate.schemaVersion !== SETTINGS_SCHEMA_VERSION && !isVersion2) {
    return { valid: false, error: `Unsupported settings schema version: ${JSON.stringify(candidate.schemaVersion)}.` }
  }
  if (typeof candidate.generatedAt !== 'string') {
    return { valid: false, error: 'Settings file is missing its generatedAt timestamp.' }
  }
  if (!isStringRecord(candidate.libraryReleases)) {
    return { valid: false, error: "Settings file's libraryReleases is missing or malformed." }
  }
  const rawSelections: unknown = candidate.selections
  let selections: SelectionEntry[]
  if (isVersion2 && Array.isArray(rawSelections) && rawSelections.every(isSelectionEntryVersion2)) {
    selections = rawSelections.map(selectionEntryFromVersion2)
  } else if (!isVersion2 && Array.isArray(rawSelections) && rawSelections.every(isSelectionEntry)) {
    selections = rawSelections
  } else {
    return { valid: false, error: "Settings file's selections list is missing or malformed." }
  }

  const file: SettingsFileV3 = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    generatedAt: candidate.generatedAt,
    libraryReleases: candidate.libraryReleases,
    selections,
  }
  const warnings: string[] = []
  if (candidate.supportingChecks !== undefined) {
    const supportingChecks = parseSupportingCheckChoices(candidate.supportingChecks)
    if (supportingChecks) file.supportingChecks = supportingChecks
    else warnings.push(UNREADABLE_SUPPORTING_CHECKS_WARNING)
  }

  return { valid: true, file, warnings }
}

export interface ImportResolution {
  selections: SelectionMap
  unresolvedRefs: RuleRef[]
}

// Splits an imported file's selections into ones that still match a
// currently-loaded rule and ones that don't (a rule renamed/removed since
// export) - the latter are reported to the admin rather than silently
// dropped, per the settings-import contract.
export function resolveImportedSelections(file: SettingsFileV3, knownIds: ReadonlySet<string>): ImportResolution {
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
    if (Object.keys(entry.odvValues).length > 0 && rowsById.has(entry.ref.id)) ids.add(entry.ref.id)
  }
  return Array.from(ids)
}

function sanitizeOdvValues(
  id: string,
  values: OdvValues,
  rule: Rule | undefined,
): { odvValues: OdvValues; dropped: DroppedImportValue[] } {
  const odvValues: OdvValues = {}
  const dropped: DroppedImportValue[] = []
  const entries = Object.entries(values)
  if (entries.length === 0) return { odvValues, dropped }
  if (!rule) return { odvValues, dropped: [{ id, reason: 'The rule details could not be loaded.' }] }

  for (const [name, value] of entries) {
    const odv = rule.odvs.find((candidate) => candidate.name === name)
    if (!odv) {
      dropped.push({ id, reason: `This rule has no organization-defined value named ${name}.` })
      continue
    }
    const preparation = prepareOdvValue(odv, value, odvSubstitutionMode(rule, odv), rule.id)
    if (preparation.valid) odvValues[name] = preparation.value
    else dropped.push({ id, reason: preparation.error })
  }
  return { odvValues, dropped }
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
    const { odvValues, dropped } = sanitizeOdvValues(id, entry.odvValues, rulesById.get(id))
    droppedValues.push(...dropped)
    selections[refKey(row.ref)] = { ref: { id: row.ref.id, path: row.ref.path }, enabled: entry.enabled, odvValues }
  }

  return { selections, unknownIds: Array.from(unknownIds), duplicateIds: Array.from(duplicateIds), droppedValues }
}
