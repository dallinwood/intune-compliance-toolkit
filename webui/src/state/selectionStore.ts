import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  migratePersistedSelections,
  PERSIST_VERSION,
  removeSelections,
  upsertSelection,
  upsertSelections,
  type OrgDefinedValue,
  type RuleRef,
  type SelectionMap,
} from '../logic/selectionEntry'

export interface SelectionState {
  selections: SelectionMap
  setEnabled: (ref: RuleRef, enabled: boolean) => void
  // One store update for the whole list, so a select-all over thousands of
  // rules re-renders once.
  setEnabledMany: (refs: readonly RuleRef[], enabled: boolean) => void
  setOdvValue: (ref: RuleRef, name: string, value: OrgDefinedValue) => void
  clearOdvValue: (ref: RuleRef, name: string) => void
  clearAll: () => void
  // Drops just these entries, e.g. saved selections whose rule is no longer
  // in the loaded library.
  removeSelections: (ids: readonly string[]) => void
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
      setEnabledMany: (refs, enabled) =>
        set((state) => ({ selections: upsertSelections(state.selections, refs, (entry) => ({ ...entry, enabled })) })),
      setOdvValue: (ref, name, value) =>
        set((state) => ({
          selections: upsertSelection(state.selections, ref, (entry) => ({
            ...entry,
            odvValues: { ...entry.odvValues, [name]: value },
          })),
        })),
      clearOdvValue: (ref, name) =>
        set((state) => ({
          selections: upsertSelection(state.selections, ref, (entry) => {
            const { [name]: _cleared, ...remainingValues } = entry.odvValues
            return { ...entry, odvValues: remainingValues }
          }),
        })),
      clearAll: () => set({ selections: {} }),
      removeSelections: (ids) => set((state) => ({ selections: removeSelections(state.selections, ids) })),
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
