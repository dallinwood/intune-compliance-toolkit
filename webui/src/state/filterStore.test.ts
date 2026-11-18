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

  it('keeps the comparison when only the tab changes on the same framework', () => {
    useFilterStore.getState().showComparison('mscp', 'a', 'b')
    useFilterStore.getState().setFrameworkPage('mscp', 'releases')

    expect(useFilterStore.getState()).toMatchObject({ framework: 'mscp', compareFrom: 'a', compareTo: 'b' })
  })
})
