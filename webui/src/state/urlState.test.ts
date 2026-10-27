import { describe, expect, it } from 'vitest'
import { benchmarkFacetValue } from '../logic/ruleFilters'
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_VIEW_ID,
  PAGE_SIZES,
  parsePageSize,
  parseUrlState,
  serializeUrlLocation,
  serializeUrlState,
  startsHistoryEntry,
  type UrlDefaults,
  type UrlState,
} from './urlState'

const defaults: UrlDefaults = { automation: 'all', size: DEFAULT_PAGE_SIZE }

const everyKeySet: UrlState = {
  view: 'reports',
  search: 'gate keeper',
  automation: 'manual',
  targets: ['macOS', 'none'],
  versions: ['macOS 27.0', '__none__'],
  sources: ['mscp', 'asd_ism'],
  benchmarks: [benchmarkFacetValue('cis_lvl1', null), benchmarkFacetValue('disa_stig', 'high')],
  sections: ['Access Control'],
  tags: ['800-53r5', 'cnssi-1253'],
  page: 3,
  size: 100,
  openRule: 'asd_ism.ism-1622',
  licence: 'microsoft.m365-e5',
  product: 'microsoft.entra-id',
  compare: ['microsoft.m365-e3', 'microsoft.m365-e5'],
}

describe('urlState', () => {
  it('round trips every key, including repeated keys', () => {
    expect(parseUrlState(serializeUrlState(everyKeySet, defaults))).toEqual({ ...everyKeySet, view: DEFAULT_VIEW_ID })
  })

  it('round trips infinite scroll as size=all', () => {
    const infinite: UrlState = { ...everyKeySet, page: 1, size: 'all' }
    const queryString = serializeUrlState(infinite, defaults)
    expect(queryString).toContain('size=all')
    expect(parseUrlState(queryString)).toEqual({ ...infinite, view: DEFAULT_VIEW_ID })
  })

  it('encodes spaces and the benchmark severity separator', () => {
    const queryString = serializeUrlState(everyKeySet, defaults)
    expect(queryString).toContain('version=macOS+27.0')
    expect(queryString).toContain('%1F')
    expect(queryString).not.toContain('\u001f')
    expect(parseUrlState(queryString).benchmarks).toEqual(everyKeySet.benchmarks)
  })

  it('writes repeated keys in the order the values were given', () => {
    const queryString = serializeUrlState({ ...parseUrlState(''), sources: ['b', 'a'] }, defaults)
    expect(queryString).toBe('?source=b&source=a')
  })

  it('serializes an all-default state to the empty string', () => {
    expect(serializeUrlState(parseUrlState(''), defaults)).toBe('')
    expect(serializeUrlState(parseUrlState('?page=1&size=50&automation=all'), defaults)).toBe('')
  })

  it('omits a size equal to the supplied default and writes one that differs', () => {
    const state = parseUrlState('?size=25')
    expect(serializeUrlState(state, { automation: 'all', size: 25 })).toBe('')
    expect(serializeUrlState(state, defaults)).toBe('?size=25')
  })

  it('reads licence, product and repeated compare params and leaves defaults out', () => {
    const state = parseUrlState('?licence=a.one&product=a.p&compare=a.one&compare=a.two')
    expect(state.licence).toBe('a.one')
    expect(state.product).toBe('a.p')
    expect(state.compare).toEqual(['a.one', 'a.two'])
    expect(serializeUrlState(state, defaults)).toBe('?licence=a.one&product=a.p&compare=a.one&compare=a.two')
    const empty = parseUrlState('?licence=&product=')
    expect(empty.licence).toBeNull()
    expect(empty.product).toBeNull()
    expect(empty.compare).toEqual([])
    expect(serializeUrlState(empty, defaults)).toBe('')
  })

  it('ignores unknown keys', () => {
    expect(parseUrlState('?utm_source=mail&foo=bar')).toEqual(parseUrlState(''))
  })

  it('falls back to page 1 for a non-numeric, zero or negative page', () => {
    for (const badPage of ['abc', '', '0', '-2', '2.5', '1e3']) {
      expect(parseUrlState(`?page=${badPage}`).page).toBe(1)
    }
    expect(parseUrlState('?page=7').page).toBe(7)
  })

  it('falls back to the default size for a size that is not one of the offered sizes', () => {
    for (const badSize of ['abc', '0', '-5', '', '7', '1000']) {
      expect(parseUrlState(`?size=${badSize}`).size).toBe(DEFAULT_PAGE_SIZE)
    }
  })

  it('leaves the page out under infinite scroll, which has no pages', () => {
    expect(serializeUrlState({ ...parseUrlState(''), page: 4, size: 'all' }, defaults)).toBe('?size=all')
  })

  it('accepts each offered page size', () => {
    for (const size of PAGE_SIZES) expect(parseUrlState(`?size=${size}`).size).toBe(size)
    expect(PAGE_SIZES).toEqual([25, 50, 100, 200, 'all'])
  })

  it('parses a page size on its own, returning null for anything not offered', () => {
    expect(parsePageSize('200')).toBe(200)
    expect(parsePageSize('all')).toBe('all')
    expect(parsePageSize('30')).toBeNull()
    expect(parsePageSize(null)).toBeNull()
  })

  it('drops empty values', () => {
    const state = parseUrlState('?source=&tag=a&q=')
    expect(state.sources).toEqual([])
    expect(state.tags).toEqual(['a'])
    expect(state.search).toBe('')
  })

  it('reads the open rule from rule= and leaves it out when there is none', () => {
    expect(parseUrlState('?q=ism-1622&rule=asd_ism.ism-1622').openRule).toBe('asd_ism.ism-1622')
    expect(parseUrlState('?rule=').openRule).toBeNull()
    expect(serializeUrlState({ ...parseUrlState(''), search: 'ism-1622', openRule: 'asd_ism.ism-1622' }, defaults)).toBe(
      '?q=ism-1622&rule=asd_ism.ism-1622',
    )
  })

  it('reads the view from the path, with or without the base and a trailing slash', () => {
    expect(parseUrlState('', '/licences').view).toBe('licences')
    expect(parseUrlState('', '/licences/').view).toBe('licences')
    expect(parseUrlState('', '/intune-compliance-toolkit/products', '/intune-compliance-toolkit/').view).toBe('products')
    expect(parseUrlState('', '/intune-compliance-toolkit/products/', '/intune-compliance-toolkit/').view).toBe('products')
    expect(parseUrlState('', '/intune-compliance-toolkit/', '/intune-compliance-toolkit/').view).toBe(DEFAULT_VIEW_ID)
    expect(parseUrlState('', '/').view).toBe(DEFAULT_VIEW_ID)
  })

  it('ignores a view parameter, since the path carries the view', () => {
    expect(parseUrlState('?view=licences', '/rules').view).toBe('rules')
    expect(parseUrlState('?view=licences').view).toBe(DEFAULT_VIEW_ID)
  })

  it('keeps an unknown path segment as written for the app to replace', () => {
    expect(parseUrlState('', '/reports').view).toBe('reports')
  })

  it('serializes to the view path under the base, then the query', () => {
    const state = { ...parseUrlState('?q=gatekeeper&size=100&rule=a.b'), view: 'licences', licence: 'a.one' }
    expect(serializeUrlLocation(state, defaults, '/intune-compliance-toolkit/')).toBe('/intune-compliance-toolkit/licences?q=gatekeeper&size=100&rule=a.b&licence=a.one')
    expect(serializeUrlLocation({ ...parseUrlState(''), view: DEFAULT_VIEW_ID }, defaults, '/')).toBe('/rules')
  })

  it('never writes a view parameter into the query', () => {
    expect(serializeUrlState({ ...parseUrlState(''), view: 'reports' }, defaults)).toBe('')
  })

  describe('startsHistoryEntry', () => {
    const base = parseUrlState('')
    it('is true for a view switch, a licence or product selection change, an opened rule and entering or leaving compare', () => {
      expect(startsHistoryEntry(base, { ...base, view: 'licences' })).toBe(true)
      expect(startsHistoryEntry(base, { ...base, licence: 'a.one' })).toBe(true)
      expect(startsHistoryEntry({ ...base, product: 'a.p' }, { ...base, product: null })).toBe(true)
      expect(startsHistoryEntry(base, { ...base, openRule: 'a.b' })).toBe(true)
      expect(startsHistoryEntry(base, { ...base, compare: ['a.one'] })).toBe(true)
      expect(startsHistoryEntry({ ...base, compare: ['a.one', 'a.two'] }, { ...base, compare: [] })).toBe(true)
    })

    it('is false for search, filters, paging, closing a rule and ticking more licences inside compare', () => {
      expect(startsHistoryEntry(base, { ...base, search: 'x' })).toBe(false)
      expect(startsHistoryEntry(base, { ...base, targets: ['macOS'], page: 2, size: 100 })).toBe(false)
      expect(startsHistoryEntry({ ...base, openRule: 'a.b' }, { ...base, openRule: null })).toBe(false)
      expect(startsHistoryEntry({ ...base, compare: ['a.one'] }, { ...base, compare: ['a.one', 'a.two'] })).toBe(false)
    })
  })

  it('reads a query string with or without the leading question mark', () => {
    expect(parseUrlState('q=abc')).toEqual(parseUrlState('?q=abc'))
  })
})
