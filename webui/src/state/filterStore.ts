import { create } from 'zustand'
import type { FilterDimension } from '../logic/ruleFilters'
import { DEFAULT_AUTOMATION, DEFAULT_PAGE_SIZE, parseUrlState, serializeUrlState, type PageSize, type UrlState } from './urlState'

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
  page: number
  size: PageSize
  setSearch: (value: string) => void
  toggleTarget: (value: string) => void
  toggleSource: (value: string) => void
  toggleVersion: (value: string) => void
  toggleBenchmark: (value: string) => void
  toggleSection: (value: string) => void
  toggleTag: (value: string) => void
  setAutomatable: (value: AutomatableFilter) => void
  setPage: (value: number) => void
  setSize: (value: PageSize) => void
  retainKnownValues: (known: Record<FilterDimension, ReadonlySet<string>>) => void
  clear: () => void
}

function toggled(set: Set<string>, value: string): Set<string> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

const AUTOMATABLE_VALUES: readonly string[] = ['all', 'automatable', 'manual']

function automatableFrom(value: string): AutomatableFilter {
  return AUTOMATABLE_VALUES.includes(value) ? (value as AutomatableFilter) : 'all'
}

function retained(set: Set<string>, known: ReadonlySet<string>): Set<string> {
  const kept = new Set(Array.from(set).filter((value) => known.has(value)))
  return kept.size === set.size ? set : kept
}

function initialStateFromUrl(): UrlState {
  return parseUrlState(typeof window === 'undefined' ? '' : window.location.search)
}

// Any filter or search change goes back to the first page.
const FIRST_PAGE = { page: 1 }

export const useFilterStore = create<FilterState>((set) => {
  const fromUrl = initialStateFromUrl()
  return {
    search: fromUrl.search,
    targets: new Set(fromUrl.targets),
    sources: new Set(fromUrl.sources),
    versions: new Set(fromUrl.versions),
    benchmarks: new Set(fromUrl.benchmarks),
    sections: new Set(fromUrl.sections),
    tags: new Set(fromUrl.tags),
    automatable: automatableFrom(fromUrl.automation),
    page: fromUrl.page,
    size: fromUrl.size,
    setSearch: (value) => set({ search: value, ...FIRST_PAGE }),
    toggleTarget: (value) => set((state) => ({ targets: toggled(state.targets, value), ...FIRST_PAGE })),
    toggleSource: (value) => set((state) => ({ sources: toggled(state.sources, value), ...FIRST_PAGE })),
    toggleVersion: (value) => set((state) => ({ versions: toggled(state.versions, value), ...FIRST_PAGE })),
    toggleBenchmark: (value) => set((state) => ({ benchmarks: toggled(state.benchmarks, value), ...FIRST_PAGE })),
    toggleSection: (value) => set((state) => ({ sections: toggled(state.sections, value), ...FIRST_PAGE })),
    toggleTag: (value) => set((state) => ({ tags: toggled(state.tags, value), ...FIRST_PAGE })),
    setAutomatable: (value) => set({ automatable: value, ...FIRST_PAGE }),
    setPage: (value) => set({ page: value }),
    setSize: (value) => set({ size: value, ...FIRST_PAGE }),
    retainKnownValues: (known) =>
      set((state) => {
        const next = {
          targets: retained(state.targets, known.targets),
          sources: retained(state.sources, known.sources),
          versions: retained(state.versions, known.versions),
          benchmarks: retained(state.benchmarks, known.benchmarks),
          sections: retained(state.sections, known.sections),
          tags: retained(state.tags, known.tags),
        }
        const unchanged = (Object.keys(next) as (keyof typeof next)[]).every((key) => next[key] === state[key])
        return unchanged ? state : next
      }),
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
        ...FIRST_PAGE,
      }),
  }
})

// replaceState, not pushState: filter clicks must not add history entries.
function writeStateToUrl(state: FilterState) {
  const queryString = serializeUrlState(
    {
      search: state.search,
      automation: state.automatable,
      targets: Array.from(state.targets),
      versions: Array.from(state.versions),
      sources: Array.from(state.sources),
      benchmarks: Array.from(state.benchmarks),
      sections: Array.from(state.sections),
      tags: Array.from(state.tags),
      page: state.page,
      size: state.size,
    },
    { automation: DEFAULT_AUTOMATION, size: DEFAULT_PAGE_SIZE },
  )
  if (queryString === window.location.search) return
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${queryString}${window.location.hash}`)
}

if (typeof window !== 'undefined') useFilterStore.subscribe(writeStateToUrl)
