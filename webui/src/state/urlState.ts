export type PageSize = number | 'all'

export const DEFAULT_VIEW_ID = 'rules'

export interface UrlState {
  // Kept as written in the URL; an id no view has is replaced by the app.
  view: string
  search: string
  automation: string
  targets: string[]
  versions: string[]
  sources: string[]
  benchmarks: string[]
  sections: string[]
  tags: string[]
  page: number
  size: PageSize
  // The full id of the rule whose details a mapped-rule link opened.
  openRule: string | null
}

export interface UrlDefaults {
  automation: string
  size: PageSize
}

export const DEFAULT_PAGE_SIZE = 50
// 'all' is infinite scroll.
export const PAGE_SIZES: readonly PageSize[] = [25, 50, 100, 200, 'all']
export const DEFAULT_AUTOMATION = 'all'

const LIST_PARAMETER_NAMES = {
  targets: 'target',
  versions: 'version',
  sources: 'source',
  benchmarks: 'benchmark',
  sections: 'section',
  tags: 'tag',
} as const

function parsePositiveInteger(text: string | null): number | null {
  if (text === null || !/^\d+$/.test(text)) return null
  const parsed = Number(text)
  return parsed >= 1 ? parsed : null
}

export function parsePageSize(text: string | null): PageSize | null {
  return PAGE_SIZES.find((size) => String(size) === text) ?? null
}

export function parseUrlState(search: string): UrlState {
  const parameters = new URLSearchParams(search)
  const listValues = (name: string) => parameters.getAll(name).filter((value) => value !== '')

  return {
    view: parameters.get('view') || DEFAULT_VIEW_ID,
    search: parameters.get('q') ?? '',
    automation: parameters.get('automation') || DEFAULT_AUTOMATION,
    targets: listValues(LIST_PARAMETER_NAMES.targets),
    versions: listValues(LIST_PARAMETER_NAMES.versions),
    sources: listValues(LIST_PARAMETER_NAMES.sources),
    benchmarks: listValues(LIST_PARAMETER_NAMES.benchmarks),
    sections: listValues(LIST_PARAMETER_NAMES.sections),
    tags: listValues(LIST_PARAMETER_NAMES.tags),
    page: parsePositiveInteger(parameters.get('page')) ?? 1,
    size: parsePageSize(parameters.get('size')) ?? DEFAULT_PAGE_SIZE,
    openRule: parameters.get('rule') || null,
  }
}

// Returns '' when everything is at its default, otherwise a query string with
// its leading '?', so the result can be appended to a path as is.
export function serializeUrlState(state: UrlState, defaults: UrlDefaults): string {
  const parameters = new URLSearchParams()
  if (state.view !== DEFAULT_VIEW_ID) parameters.set('view', state.view)
  if (state.search !== '') parameters.set('q', state.search)
  if (state.automation !== defaults.automation) parameters.set('automation', state.automation)
  for (const [stateKey, parameterName] of Object.entries(LIST_PARAMETER_NAMES)) {
    for (const value of state[stateKey as keyof typeof LIST_PARAMETER_NAMES]) parameters.append(parameterName, value)
  }
  // Infinite scroll has no pages.
  if (state.page > 1 && state.size !== 'all') parameters.set('page', String(state.page))
  if (state.size !== defaults.size) parameters.set('size', String(state.size))
  if (state.openRule !== null) parameters.set('rule', state.openRule)

  const queryString = parameters.toString()
  return queryString === '' ? '' : `?${queryString}`
}
