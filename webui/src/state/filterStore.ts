import { create } from 'zustand'

export type AutomatableFilter = 'all' | 'automatable' | 'manual'

export interface FilterState {
  search: string
  targets: Set<string>
  sources: Set<string>
  versions: Set<string>
  benchmarks: Set<string>
  sections: Set<string>
  tags: Set<string>
  automatable: AutomatableFilter
  setSearch: (value: string) => void
  toggleTarget: (value: string) => void
  toggleSource: (value: string) => void
  toggleVersion: (value: string) => void
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
  targets: new Set(),
  sources: new Set(),
  versions: new Set(),
  benchmarks: new Set(),
  sections: new Set(),
  tags: new Set(),
  automatable: 'all',
  setSearch: (value) => set({ search: value }),
  toggleTarget: (value) => set((state) => ({ targets: toggled(state.targets, value) })),
  toggleSource: (value) => set((state) => ({ sources: toggled(state.sources, value) })),
  toggleVersion: (value) => set((state) => ({ versions: toggled(state.versions, value) })),
  toggleBenchmark: (value) => set((state) => ({ benchmarks: toggled(state.benchmarks, value) })),
  toggleSection: (value) => set((state) => ({ sections: toggled(state.sections, value) })),
  toggleTag: (value) => set((state) => ({ tags: toggled(state.tags, value) })),
  setAutomatable: (value) => set({ automatable: value }),
  clear: () =>
    set({
      search: '',
      targets: new Set(),
      sources: new Set(),
      versions: new Set(),
      benchmarks: new Set(),
      sections: new Set(),
      tags: new Set(),
      automatable: 'all',
    }),
}))
