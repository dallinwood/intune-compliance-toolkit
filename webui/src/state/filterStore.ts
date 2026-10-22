import { create } from 'zustand'

export type AutomatableFilter = 'all' | 'automatable' | 'manual'

export interface FilterState {
  search: string
  platforms: Set<string>
  sources: Set<string>
  osVersions: Set<string>
  benchmarks: Set<string>
  sections: Set<string>
  tags: Set<string>
  automatable: AutomatableFilter
  setSearch: (value: string) => void
  togglePlatform: (value: string) => void
  toggleSource: (value: string) => void
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
  platforms: new Set(),
  sources: new Set(),
  osVersions: new Set(),
  benchmarks: new Set(),
  sections: new Set(),
  tags: new Set(),
  automatable: 'all',
  setSearch: (value) => set({ search: value }),
  togglePlatform: (value) => set((state) => ({ platforms: toggled(state.platforms, value) })),
  toggleSource: (value) => set((state) => ({ sources: toggled(state.sources, value) })),
  toggleOsVersion: (value) => set((state) => ({ osVersions: toggled(state.osVersions, value) })),
  toggleBenchmark: (value) => set((state) => ({ benchmarks: toggled(state.benchmarks, value) })),
  toggleSection: (value) => set((state) => ({ sections: toggled(state.sections, value) })),
  toggleTag: (value) => set((state) => ({ tags: toggled(state.tags, value) })),
  setAutomatable: (value) => set({ automatable: value }),
  clear: () =>
    set({
      search: '',
      platforms: new Set(),
      sources: new Set(),
      osVersions: new Set(),
      benchmarks: new Set(),
      sections: new Set(),
      tags: new Set(),
      automatable: 'all',
    }),
}))
