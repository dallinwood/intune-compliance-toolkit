import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  DEFAULT_SUPPORTING_CHECK_CHOICES,
  pruneSupportingCheckChoices,
  type SupportingCheckChoices,
  type SupportingCheckOffers,
} from '../logic/supportingChecks'

export interface SupportingChecksState extends SupportingCheckChoices {
  setIncludeSupporting: (include: boolean) => void
  // 'default' removes the override, so the rule follows its depth's default again.
  setRuleChoice: (ruleId: string, choice: 'include' | 'exclude' | 'default') => void
  // The caller passes only ids whose choice differs from their default.
  setGroupChoice: (ruleIds: readonly string[], choice: 'include' | 'exclude') => void
  // Drops overrides for rules no longer offered.
  prune: (offers: SupportingCheckOffers) => void
  // Wholesale replace, used by settings import.
  replaceAll: (choices: SupportingCheckChoices) => void
}

export const SUPPORTING_CHECKS_STORAGE_KEY = 'intune-toolkit:supporting-checks'

// Storage can be missing or throw (private windows, blocked site data); the
// choices then simply live for this visit only.
const resilientStorage = {
  getItem: (name: string) => {
    try {
      return window.localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name: string, value: string) => {
    try {
      window.localStorage.setItem(name, value)
    } catch {
      // Not remembered for the next visit.
    }
  },
  removeItem: (name: string) => {
    try {
      window.localStorage.removeItem(name)
    } catch {
      // Nothing to forget.
    }
  },
}

export const useSupportingChecksStore = create<SupportingChecksState>()(
  persist(
    (set) => ({
      ...DEFAULT_SUPPORTING_CHECK_CHOICES,
      setIncludeSupporting: (include) => set({ includeSupporting: include }),
      setRuleChoice: (ruleId, choice) =>
        set((state) => {
          const otherOverrides = Object.fromEntries(Object.entries(state.overrides).filter(([existingId]) => existingId !== ruleId))
          return { overrides: choice === 'default' ? otherOverrides : { ...otherOverrides, [ruleId]: choice } }
        }),
      setGroupChoice: (ruleIds, choice) =>
        set((state) => ({
          overrides: { ...state.overrides, ...Object.fromEntries(ruleIds.map((ruleId) => [ruleId, choice])) },
        })),
      prune: (offers) =>
        set((state) => {
          const pruned = pruneSupportingCheckChoices(state, offers)
          return pruned === state ? state : { overrides: pruned.overrides }
        }),
      replaceAll: (choices) => set({ includeSupporting: choices.includeSupporting, overrides: choices.overrides }),
    }),
    {
      name: SUPPORTING_CHECKS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => resilientStorage),
      partialize: (state) => ({ includeSupporting: state.includeSupporting, overrides: state.overrides }),
    },
  ),
)
