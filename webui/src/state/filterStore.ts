import { create } from 'zustand'
import type { FilterDimension, FilterValues } from '../logic/ruleFilters'
import {
  DEFAULT_AUTOMATION,
  DEFAULT_PAGE_SIZE,
  parsePageSize,
  parseUrlState,
  serializeUrlLocation,
  startsHistoryEntry,
  type PageSize,
  type UrlState,
} from './urlState'

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
  // One update, so one history entry: a catalog entry opened in its tab, and
  // a licence opened out of a comparison.
  showCatalogEntry: (view: 'licences' | 'products', id: string) => void
  showLicenceFromComparison: (id: string) => void
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

const BASE_PATH = import.meta.env.BASE_URL

// A size in the URL wins; without one, the size this browser last chose.
function stateFromLocation(): UrlState {
  if (typeof window === 'undefined') return parseUrlState('')
  const fromUrl = parseUrlState(window.location.search, window.location.pathname, BASE_PATH)
  if (new URLSearchParams(window.location.search).has('size')) return fromUrl
  return { ...fromUrl, size: readStoredPageSize() ?? fromUrl.size }
}

function filterValuesOf(urlState: UrlState) {
  return {
    view: urlState.view,
    search: urlState.search,
    targets: new Set(urlState.targets),
    sources: new Set(urlState.sources),
    versions: new Set(urlState.versions),
    benchmarks: new Set(urlState.benchmarks),
    sections: new Set(urlState.sections),
    tags: new Set(urlState.tags),
    automatable: automatableFrom(urlState.automation),
    page: urlState.page,
    size: urlState.size,
    openRule: urlState.openRule,
    licence: urlState.licence,
    product: urlState.product,
    compare: urlState.compare,
  }
}

// Any filter or search change goes back to the first page.
const FIRST_PAGE = { page: 1 }

export const useFilterStore = create<FilterState>((set) => {
  return {
    ...filterValuesOf(stateFromLocation()),
    openRuleRequest: 0,
    setView: (value) => set({ view: value }),
    setLicence: (id) => set({ licence: id }),
    setProduct: (id) => set({ product: id }),
    setCompare: (ids) => set({ compare: ids }),
    showCatalogEntry: (view, id) => set(view === 'licences' ? { view, licence: id } : { view, product: id }),
    showLicenceFromComparison: (id) => set({ licence: id, compare: [] }),
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
  return `${serializeUrlLocation({ ...urlStateOf(state), view: viewId }, URL_DEFAULTS, BASE_PATH)}${window.location.hash}`
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
  return `${serializeUrlLocation(entryState, URL_DEFAULTS, BASE_PATH)}${window.location.hash}`
}

// Set while a change must not add a history entry: the address already is
// the new state (back and forward), or the app is correcting the address.
let isReplacingHistory = false

function runReplacingHistory(action: () => void) {
  isReplacingHistory = true
  try {
    action()
  } finally {
    isReplacingHistory = false
  }
}

// An address no view has (or a view-less one) is rewritten in place, so it
// never becomes a history entry of its own.
export function replaceView(viewId: string) {
  runReplacingHistory(() => useFilterStore.getState().setView(viewId))
}

function writeStateToUrl(state: FilterState, previousState?: FilterState) {
  const target = `${serializeUrlLocation(urlStateOf(state), URL_DEFAULTS, BASE_PATH)}${window.location.hash}`
  if (target === `${window.location.pathname}${window.location.search}${window.location.hash}`) return
  const isNavigation = previousState !== undefined && !isReplacingHistory && startsHistoryEntry(urlStateOf(previousState), urlStateOf(state))
  if (isNavigation) window.history.pushState(window.history.state, '', target)
  else window.history.replaceState(window.history.state, '', target)
}

if (typeof window !== 'undefined') {
  useFilterStore.subscribe(writeStateToUrl)
  // Back and forward: the address is already right, so only the store follows.
  window.addEventListener('popstate', () => {
    runReplacingHistory(() =>
      useFilterStore.setState((state) => {
        const restored = filterValuesOf(stateFromLocation())
        const shouldRevealRule = restored.openRule !== null
        return { ...restored, openRuleRequest: shouldRevealRule ? state.openRuleRequest + 1 : state.openRuleRequest }
      }),
    )
  })
  // A bare base address shows Rules, so its address says so.
  writeStateToUrl(useFilterStore.getState())
}
