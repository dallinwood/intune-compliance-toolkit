import { refKey, type OrgDefinedValue, type RuleRef, type SelectionEntry, type SelectionMap } from './selectionEntry'

export const SETTINGS_SCHEMA_VERSION = 1

// The same shape backs localStorage persistence and the exported/imported
// settings file - a rule is referenced by identity only, never by embedding
// its content, so exporting never duplicates anything already in the repo.
export interface SettingsFileV1 {
  schemaVersion: 1
  generatedAt: string
  selections: SelectionEntry[]
}

export function buildSettingsFile(selections: SelectionMap, generatedAt: string): SettingsFileV1 {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    generatedAt,
    selections: Object.values(selections),
  }
}

export function serializeSettingsFile(file: SettingsFileV1): string {
  return JSON.stringify(file, null, 2)
}

function isRuleRef(value: unknown): value is RuleRef {
  if (typeof value !== 'object' || value === null) return false
  const ref = value as Record<string, unknown>
  return (
    typeof ref.family === 'string' &&
    typeof ref.product === 'string' &&
    typeof ref.version === 'string' &&
    typeof ref.file === 'string' &&
    typeof ref.id === 'string'
  )
}

function isOrgDefinedValue(value: unknown): value is OrgDefinedValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function isSelectionEntry(value: unknown): value is SelectionEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  if (!isRuleRef(entry.ref)) return false
  if (typeof entry.enabled !== 'boolean') return false
  if (entry.selectedAuditMethodIndex !== null && typeof entry.selectedAuditMethodIndex !== 'number') return false
  if (typeof entry.organizationDefinedValues !== 'object' || entry.organizationDefinedValues === null) return false
  return Object.values(entry.organizationDefinedValues as Record<string, unknown>).every(isOrgDefinedValue)
}

export type SettingsFileValidation = { valid: true; file: SettingsFileV1 } | { valid: false; error: string }

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
  if (!Array.isArray(candidate.selections) || !candidate.selections.every(isSelectionEntry)) {
    return { valid: false, error: 'Settings file\'s selections list is missing or malformed.' }
  }

  return {
    valid: true,
    file: { schemaVersion: SETTINGS_SCHEMA_VERSION, generatedAt: candidate.generatedAt, selections: candidate.selections },
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
export function resolveImportedSelections(file: SettingsFileV1, knownRefKeys: ReadonlySet<string>): ImportResolution {
  const selections: SelectionMap = {}
  const unresolvedRefs: RuleRef[] = []

  for (const entry of file.selections) {
    const key = refKey(entry.ref)
    if (knownRefKeys.has(key)) {
      selections[key] = entry
    } else {
      unresolvedRefs.push(entry.ref)
    }
  }

  return { selections, unresolvedRefs }
}
