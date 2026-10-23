export type PageSize = number | 'all'

export interface UrlState {
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
}

export interface UrlDefaults {
  automation: string
  size: PageSize
}

export const DEFAULT_PAGE_SIZE = 50
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

export function parseUrlState(search: string): UrlState {
  const parameters = new URLSearchParams(search)
  const sizeText = parameters.get('size')
  const listValues = (name: string) => parameters.getAll(name).filter((value) => value !== '')

  return {
    search: parameters.get('q') ?? '',
    automation: parameters.get('automation') || DEFAULT_AUTOMATION,
    targets: listValues(LIST_PARAMETER_NAMES.targets),
    versions: listValues(LIST_PARAMETER_NAMES.versions),
    sources: listValues(LIST_PARAMETER_NAMES.sources),
    benchmarks: listValues(LIST_PARAMETER_NAMES.benchmarks),
    sections: listValues(LIST_PARAMETER_NAMES.sections),
    tags: listValues(LIST_PARAMETER_NAMES.tags),
    page: parsePositiveInteger(parameters.get('page')) ?? 1,
    size: sizeText === 'all' ? 'all' : (parsePositiveInteger(sizeText) ?? DEFAULT_PAGE_SIZE),
  }
}

// Returns '' when everything is at its default, otherwise a query string with
// its leading '?', so the result can be appended to a path as is.
export function serializeUrlState(state: UrlState, defaults: UrlDefaults): string {
  const parameters = new URLSearchParams()
  if (state.search !== '') parameters.set('q', state.search)
  if (state.automation !== defaults.automation) parameters.set('automation', state.automation)
  for (const [stateKey, parameterName] of Object.entries(LIST_PARAMETER_NAMES)) {
    for (const value of state[stateKey as keyof typeof LIST_PARAMETER_NAMES]) parameters.append(parameterName, value)
  }
  if (state.page > 1) parameters.set('page', String(state.page))
  if (state.size !== defaults.size) parameters.set('size', String(state.size))

  const queryString = parameters.toString()
  return queryString === '' ? '' : `?${queryString}`
}
