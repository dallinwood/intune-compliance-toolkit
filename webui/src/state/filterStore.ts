import { create } from 'zustand'
import type { FilterDimension, FilterValues } from '../logic/ruleFilters'
import { DEFAULT_AUTOMATION, DEFAULT_PAGE_SIZE, parsePageSize, parseUrlState, serializeUrlState, type PageSize, type UrlState } from './urlState'

export type AutomatableFilter = 'all' | 'automatable' | 'manual'

export interface FilterState {
  // The top-level view's id. The Rules view's own state above stays in the
  // store, and so in the URL, while another view is shown.
  view: string
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
  // A rule a mapped-rule link opened: its details stay open, and it survives
  // a shared URL. Typing a search or collapsing that rule lets it go.
  openRule: string | null
  // Counts link clicks, so a click on a link to the rule already open still
  // reveals it again.
  openRuleRequest: number
  licence: string | null
  product: string | null
  compare: string[]
  setView: (value: string) => void
  setLicence: (id: string | null) => void
  setProduct: (id: string | null) => void
  setCompare: (ids: string[]) => void
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
  // One update, so the URL is written once: the filters that show the rule
  // (see filtersShowingRule), the first page and the open rule.
  showRule: (ruleId: string, filters: FilterValues) => void
  closeOpenRule: () => void
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

const PAGE_SIZE_STORAGE_KEY = 'intune-toolkit:page-size'

// Storage can be missing or throw (private windows, blocked site data); the
// remembered size is a convenience, so any failure just means no memory.
function readStoredPageSize(): PageSize | null {
  try {
    return parsePageSize(window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY))
  } catch {
    return null
  }
}

function storePageSize(size: PageSize) {
  try {
    window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(size))
  } catch {
    // Not remembered for the next visit; the URL still carries it.
  }
}

// A size in the URL wins; without one, the size this browser last chose.
function initialStateFromUrl(): UrlState {
  if (typeof window === 'undefined') return parseUrlState('')
  const fromUrl = parseUrlState(window.location.search)
  if (new URLSearchParams(window.location.search).has('size')) return fromUrl
  return { ...fromUrl, size: readStoredPageSize() ?? fromUrl.size }
}

// Any filter or search change goes back to the first page.
const FIRST_PAGE = { page: 1 }

export const useFilterStore = create<FilterState>((set) => {
  const fromUrl = initialStateFromUrl()
  return {
    view: fromUrl.view,
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
    openRule: fromUrl.openRule,
    openRuleRequest: 0,
    licence: fromUrl.licence,
    product: fromUrl.product,
    compare: fromUrl.compare,
    setView: (value) => set({ view: value }),
    setLicence: (id) => set({ licence: id }),
    setProduct: (id) => set({ product: id }),
    setCompare: (ids) => set({ compare: ids }),
    setSearch: (value) => set({ search: value, openRule: null, ...FIRST_PAGE }),
    toggleTarget: (value) => set((state) => ({ targets: toggled(state.targets, value), ...FIRST_PAGE })),
    toggleSource: (value) => set((state) => ({ sources: toggled(state.sources, value), ...FIRST_PAGE })),
    toggleVersion: (value) => set((state) => ({ versions: toggled(state.versions, value), ...FIRST_PAGE })),
    toggleBenchmark: (value) => set((state) => ({ benchmarks: toggled(state.benchmarks, value), ...FIRST_PAGE })),
    toggleSection: (value) => set((state) => ({ sections: toggled(state.sections, value), ...FIRST_PAGE })),
    toggleTag: (value) => set((state) => ({ tags: toggled(state.tags, value), ...FIRST_PAGE })),
    setAutomatable: (value) => set({ automatable: value, ...FIRST_PAGE }),
    setPage: (value) => set({ page: value }),
    setSize: (value) => {
      storePageSize(value)
      set({ size: value, ...FIRST_PAGE })
    },
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
    showRule: (ruleId, filters) =>
      set((state) => ({ ...filters, openRule: ruleId, openRuleRequest: state.openRuleRequest + 1, ...FIRST_PAGE })),
    closeOpenRule: () => set({ openRule: null }),
    clear: () =>
      set({
        openRule: null,
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

function urlStateOf(state: FilterState): UrlState {
  return {
    view: state.view,
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
    openRule: state.openRule,
    licence: state.licence,
    product: state.product,
    compare: state.compare,
  }
}

const URL_DEFAULTS = { automation: DEFAULT_AUTOMATION, size: DEFAULT_PAGE_SIZE }

// The address of a view with the current filters, so a copied or
// opened-in-a-new-tab tab link lands on the same Rules state.
export function hrefForView(state: FilterState, viewId: string): string {
  return `${window.location.pathname}${serializeUrlState({ ...urlStateOf(state), view: viewId }, URL_DEFAULTS)}${window.location.hash}`
}

// The address of a catalog entry in its tab, for a link that can also open
// in a new tab. It keeps the rest of the current state (the Rules filters and
// the other catalog selection) and sets the view and the entry's own id.
export function hrefForCatalogEntry(state: FilterState, view: 'licences' | 'products', id: string): string {
  const entryState: UrlState = {
    ...urlStateOf(state),
    view,
    licence: view === 'licences' ? id : state.licence,
    product: view === 'products' ? id : state.product,
  }
  return `${window.location.pathname}${serializeUrlState(entryState, URL_DEFAULTS)}${window.location.hash}`
}

// replaceState, not pushState: filter clicks must not add history entries.
function writeStateToUrl(state: FilterState) {
  const queryString = serializeUrlState(urlStateOf(state), URL_DEFAULTS)
  if (queryString === window.location.search) return
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${queryString}${window.location.hash}`)
}

if (typeof window !== 'undefined') useFilterStore.subscribe(writeStateToUrl)
