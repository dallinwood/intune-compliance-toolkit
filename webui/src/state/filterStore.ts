import { create } from 'zustand'

export type AutomatableFilter = 'all' | 'automatable' | 'manual'

export interface FilterState {
  search: string
  products: Set<string>
  versions: Set<string>
  platforms: Set<string>
  profiles: Set<string>
  automatable: AutomatableFilter
  setSearch: (value: string) => void
  toggleProduct: (value: string) => void
  toggleVersion: (value: string) => void
  togglePlatform: (value: string) => void
  toggleProfile: (value: string) => void
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
  products: new Set(),
  versions: new Set(),
  platforms: new Set(),
  profiles: new Set(),
  automatable: 'all',
  setSearch: (value) => set({ search: value }),
  toggleProduct: (value) => set((state) => ({ products: toggled(state.products, value) })),
  toggleVersion: (value) => set((state) => ({ versions: toggled(state.versions, value) })),
  togglePlatform: (value) => set((state) => ({ platforms: toggled(state.platforms, value) })),
  toggleProfile: (value) => set((state) => ({ profiles: toggled(state.profiles, value) })),
  setAutomatable: (value) => set({ automatable: value }),
  clear: () =>
    set({
      search: '',
      products: new Set(),
      versions: new Set(),
      platforms: new Set(),
      profiles: new Set(),
      automatable: 'all',
    }),
}))
