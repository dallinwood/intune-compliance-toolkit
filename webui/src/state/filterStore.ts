import { create } from 'zustand'

export type AutomatableFilter = 'all' | 'automatable' | 'manual'

export interface FilterState {
  search: string
  osVersions: Set<string>
  benchmarks: Set<string>
  sections: Set<string>
  tags: Set<string>
  automatable: AutomatableFilter
  setSearch: (value: string) => void
  toggleOsVersion: (value: string) => void
  toggleBenchmark: (value: string) => void
  toggleSection: (value: string) => void
  toggleTag: (value: string) => void
  setAutomatable: (value: AutomatableFilter) => void
  clear: () => void
}

function toggled(set: Set<string>, value: string): Set<string> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

export const useFilterStore = create<FilterState>((set) => ({
  search: '',
  osVersions: new Set(),
  benchmarks: new Set(),
  sections: new Set(),
  tags: new Set(),
  automatable: 'all',
  setSearch: (value) => set({ search: value }),
  toggleOsVersion: (value) => set((state) => ({ osVersions: toggled(state.osVersions, value) })),
  toggleBenchmark: (value) => set((state) => ({ benchmarks: toggled(state.benchmarks, value) })),
  toggleSection: (value) => set((state) => ({ sections: toggled(state.sections, value) })),
  toggleTag: (value) => set((state) => ({ tags: toggled(state.tags, value) })),
  setAutomatable: (value) => set({ automatable: value }),
  clear: () =>
    set({
      search: '',
      osVersions: new Set(),
      benchmarks: new Set(),
      sections: new Set(),
      tags: new Set(),
      automatable: 'all',
    }),
}))
