// Pure selection-state logic, kept free of Zustand/localStorage so it's
// trivially unit-testable - state/selectionStore.ts is a thin binding layer
// over these functions.

export interface RuleRef {
  id: string
  // Relative to baselines/, e.g. mscp/rules/os_gatekeeper_enable.json
  path: string
}

export type OrgDefinedValue = string | number

export interface SelectionEntry {
  ref: RuleRef
  enabled: boolean
  // null = the admin has not chosen a value; the effective value then falls
  // back to mSCP's recommended value (see logic/odv.ts).
  odvValue: OrgDefinedValue | null
}

export type SelectionMap = Record<string, SelectionEntry>

export const PERSIST_VERSION = 2

export function refKey(ref: RuleRef): string {
  return ref.id
}

export function createSelectionEntry(ref: RuleRef): SelectionEntry {
  return { ref, enabled: false, odvValue: null }
}

// A rule only gets an entry in the map once the user first interacts with
// it - until then it reads as its default via getSelection()/isEnabled().
export function upsertSelection(
  selections: SelectionMap,
  ref: RuleRef,
  update: (entry: SelectionEntry) => SelectionEntry,
): SelectionMap {
  const key = refKey(ref)
  const existing = selections[key] ?? createSelectionEntry(ref)
  return { ...selections, [key]: update(existing) }
}

export function getSelection(selections: SelectionMap, ref: RuleRef): SelectionEntry {
  return selections[refKey(ref)] ?? createSelectionEntry(ref)
}

export function isEnabled(selections: SelectionMap, ref: RuleRef): boolean {
  return getSelection(selections, ref).enabled
}

// Selections persisted by the CIS-era app (version 1) reference rules that
// no longer exist, so they are discarded rather than converted.
export function migratePersistedSelections(persistedState: unknown, version: number): { selections: SelectionMap } {
  if (version < PERSIST_VERSION) return { selections: {} }
  return persistedState as { selections: SelectionMap }
}
