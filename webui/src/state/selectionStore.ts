import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  migratePersistedSelections,
  PERSIST_VERSION,
  upsertSelection,
  type OrgDefinedValue,
  type RuleRef,
  type SelectionMap,
} from '../logic/selectionEntry'

export interface SelectionState {
  selections: SelectionMap
  setEnabled: (ref: RuleRef, enabled: boolean) => void
  setOdvValue: (ref: RuleRef, value: OrgDefinedValue) => void
  clearOdvValue: (ref: RuleRef) => void
  clearAll: () => void
  // Wholesale replace - used by settings import, which is a "load this
  // snapshot" action, not a per-field merge.
  setAllSelections: (selections: SelectionMap) => void
}

export const useSelectionStore = create<SelectionState>()(
  persist(
    (set) => ({
      selections: {},
      setEnabled: (ref, enabled) =>
        set((state) => ({ selections: upsertSelection(state.selections, ref, (entry) => ({ ...entry, enabled })) })),
      setOdvValue: (ref, value) =>
        set((state) => ({
          selections: upsertSelection(state.selections, ref, (entry) => ({ ...entry, odvValue: value })),
        })),
      clearOdvValue: (ref) =>
        set((state) => ({
          selections: upsertSelection(state.selections, ref, (entry) => ({ ...entry, odvValue: null })),
        })),
      clearAll: () => set({ selections: {} }),
      setAllSelections: (selections) => set({ selections }),
    }),
    {
      name: 'intune-toolkit:selections',
      version: PERSIST_VERSION,
      migrate: migratePersistedSelections,
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
