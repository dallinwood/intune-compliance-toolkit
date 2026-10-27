import { describe, expect, it } from 'vitest'
import { benchmarkFacetValue } from '../logic/ruleFilters'
import { DEFAULT_PAGE_SIZE, DEFAULT_VIEW_ID, PAGE_SIZES, parsePageSize, parseUrlState, serializeUrlState, type UrlDefaults, type UrlState } from './urlState'

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
    expect(parseUrlState(serializeUrlState(everyKeySet, defaults))).toEqual(everyKeySet)
  })

  it('round trips infinite scroll as size=all', () => {
    const infinite: UrlState = { ...everyKeySet, page: 1, size: 'all' }
    const queryString = serializeUrlState(infinite, defaults)
    expect(queryString).toContain('size=all')
    expect(parseUrlState(queryString)).toEqual(infinite)
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
    const state = parseUrlState('?view=licences&licence=a.one&product=a.p&compare=a.one&compare=a.two')
    expect(state.licence).toBe('a.one')
    expect(state.product).toBe('a.p')
    expect(state.compare).toEqual(['a.one', 'a.two'])
    expect(serializeUrlState(state, defaults)).toBe('?view=licences&licence=a.one&product=a.p&compare=a.one&compare=a.two')
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

  it('leaves the default view out of the URL and reads a missing view as the default', () => {
    expect(serializeUrlState({ ...parseUrlState(''), view: DEFAULT_VIEW_ID }, defaults)).toBe('')
    expect(parseUrlState('').view).toBe(DEFAULT_VIEW_ID)
    expect(parseUrlState('?view=').view).toBe(DEFAULT_VIEW_ID)
    expect(serializeUrlState({ ...parseUrlState(''), view: 'reports' }, defaults)).toBe('?view=reports')
  })

  it('keeps the rules view state in the URL while another view is shown', () => {
    const state = { ...parseUrlState('?q=gatekeeper&size=100&rule=a.b'), view: 'reports' }
    expect(serializeUrlState(state, defaults)).toBe('?view=reports&q=gatekeeper&size=100&rule=a.b')
  })

  it('reads a query string with or without the leading question mark', () => {
    expect(parseUrlState('q=abc')).toEqual(parseUrlState('?q=abc'))
  })
})
