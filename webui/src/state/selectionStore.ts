import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { upsertSelection, type OrgDefinedValue, type RuleRef, type SelectionMap } from '../logic/selectionEntry'

export interface SelectionState {
  selections: SelectionMap
  setEnabled: (ref: RuleRef, enabled: boolean) => void
  setAuditMethodIndex: (ref: RuleRef, index: number) => void
  setOrganizationDefinedValue: (ref: RuleRef, variable: string, value: OrgDefinedValue) => void
  clearOrganizationDefinedValue: (ref: RuleRef, variable: string) => void
  clearAll: () => void
  // Wholesale replace - used by settings import, which is a "load this
  // snapshot" action, not a per-field merge.
  setAllSelections: (selections: SelectionMap) => void
}

// Same shape as the eventual export/import settings file (schemaVersion +
// selections keyed by ref) - localStorage persistence and file export are
// meant to share this schema so a future export can just serialize `state`.
export const useSelectionStore = create<SelectionState>()(
  persist(
    (set) => ({
      selections: {},
      setEnabled: (ref, enabled) =>
        set((state) => ({ selections: upsertSelection(state.selections, ref, (entry) => ({ ...entry, enabled })) })),
      setAuditMethodIndex: (ref, index) =>
        set((state) => ({
          selections: upsertSelection(state.selections, ref, (entry) => ({ ...entry, selectedAuditMethodIndex: index })),
        })),
      setOrganizationDefinedValue: (ref, variable, value) =>
        set((state) => ({
          selections: upsertSelection(state.selections, ref, (entry) => ({
            ...entry,
            organizationDefinedValues: { ...entry.organizationDefinedValues, [variable]: value },
          })),
        })),
      // Removes the key entirely rather than storing an empty/zero value,
      // so a cleared field reads as "never answered" (the placeholder)
      // instead of as an explicit 0/"" the admin didn't actually choose.
      clearOrganizationDefinedValue: (ref, variable) =>
        set((state) => ({
          selections: upsertSelection(state.selections, ref, (entry) => {
            const { [variable]: _removed, ...rest } = entry.organizationDefinedValues
            return { ...entry, organizationDefinedValues: rest }
          }),
        })),
      clearAll: () => set({ selections: {} }),
      setAllSelections: (selections) => set({ selections }),
    }),
    {
      name: 'intune-toolkit:selections',
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
