import { describe, expect, it } from 'vitest'
import { useFilterStore } from './filterStore'

describe('setFrameworkPage', () => {
  it('drops the previous framework release comparison when switching framework', () => {
    const store = useFilterStore.getState()
    store.showComparison('mscp', 'a', 'b')
    useFilterStore.getState().setCompareSearch('access')
    useFilterStore.getState().setFrameworkPage(null, null)
    useFilterStore.getState().setFrameworkPage('asd_ism', null)

    expect(useFilterStore.getState()).toMatchObject({
      framework: 'asd_ism',
      frameworkTab: null,
      compareFrom: null,
      compareTo: null,
      compareSearch: '',
    })
  })

  it('resets the facet filters and the page when switching framework, keeping search, automation and sources', () => {
    useFilterStore.getState().setFrameworkPage('mscp', 'rules')
    useFilterStore.setState({
      sections: new Set(['s']),
      versions: new Set(['v']),
      benchmarks: new Set(['b']),
      tags: new Set(['t']),
      linked: new Set(['asd_ism']),
      sources: new Set(['mscp']),
      search: 'audit',
      automatable: 'manual',
      page: 3,
    })
    useFilterStore.getState().setFrameworkPage('asd_ism', 'rules')

    const state = useFilterStore.getState()
    expect([state.sections.size, state.versions.size, state.benchmarks.size, state.tags.size, state.linked.size]).toEqual([0, 0, 0, 0, 0])
    expect(state.page).toBe(1)
    expect(state.search).toBe('audit')
    expect(state.automatable).toBe('manual')
    expect([...state.sources]).toEqual(['mscp'])
  })

  it('keeps the facet filters when only the tab changes', () => {
    useFilterStore.getState().setFrameworkPage('mscp', 'rules')
    useFilterStore.setState({ linked: new Set(['asd_ism']), page: 2 })
    useFilterStore.getState().setFrameworkPage('mscp', 'coverage')

    expect([...useFilterStore.getState().linked]).toEqual(['asd_ism'])
  })

  it('keeps the comparison when only the tab changes on the same framework', () => {
    useFilterStore.getState().showComparison('mscp', 'a', 'b')
    useFilterStore.getState().setFrameworkPage('mscp', 'releases')

    expect(useFilterStore.getState()).toMatchObject({ framework: 'mscp', compareFrom: 'a', compareTo: 'b' })
  })
})

describe('clear', () => {
  it('keeps the hidden sources while a framework page scopes them', () => {
    useFilterStore.getState().setFrameworkPage('mscp', 'rules')
    useFilterStore.setState({ sources: new Set(['mscp']), search: 'audit' })
    useFilterStore.getState().clear()

    expect(useFilterStore.getState().search).toBe('')
    expect([...useFilterStore.getState().sources]).toEqual(['mscp'])
  })

  it('clears sources on the all-rules page, where they are a visible filter', () => {
    useFilterStore.getState().setFrameworkPage('all', 'rules')
    useFilterStore.setState({ sources: new Set(['mscp']) })
    useFilterStore.getState().clear()

    expect(useFilterStore.getState().sources.size).toBe(0)
  })
})
