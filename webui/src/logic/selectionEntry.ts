// Pure selection-state logic, kept free of Zustand/localStorage so it's
// trivially unit-testable - state/selectionStore.ts is a thin binding layer
// over these functions.

export interface RuleRef {
  family: string
  product: string
  version: string
  file: string
  id: string
}

export type OrgDefinedValue = string | number | boolean

export interface SelectionEntry {
  ref: RuleRef
  enabled: boolean
  // null = no explicit choice; resolved via logic/auditMethods.ts's
  // effectiveAuditMethodIndex(), which defaults to the rule's first
  // scripted method. Only ever needs to be non-null when a rule has 2+
  // scripted methods and the admin picked a specific one. There is no
  // remediation-method selection - remediation is informational only and
  // never feeds a generated script.
  selectedAuditMethodIndex: number | null
  organizationDefinedValues: Record<string, OrgDefinedValue>
}

export type SelectionMap = Record<string, SelectionEntry>

export function refKey(ref: RuleRef): string {
  return `${ref.family}/${ref.product}/${ref.version}/${ref.file}`
}

export function createSelectionEntry(ref: RuleRef): SelectionEntry {
  return {
    ref,
    enabled: false,
    selectedAuditMethodIndex: null,
    organizationDefinedValues: {},
  }
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
