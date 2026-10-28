import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoadedCatalogIndex } from '../data/catalog'

const loadCatalogIndex = vi.fn<() => Promise<LoadedCatalogIndex>>()
vi.mock('../data/catalog', () => ({ loadCatalogIndex }))

const failedLoad: LoadedCatalogIndex = { index: null, warning: 'The catalog index could not be fetched.' }
const successfulLoad = { index: {}, warning: null } as LoadedCatalogIndex

async function freshRequestCatalogOnce() {
  vi.resetModules()
  return (await import('./useCatalogIndex')).requestCatalogOnce
}

describe('requestCatalogOnce', () => {
  beforeEach(() => {
    loadCatalogIndex.mockReset()
  })

  it('shares one fetch between callers while it succeeds', async () => {
    loadCatalogIndex.mockResolvedValue(successfulLoad)
    const requestCatalogOnce = await freshRequestCatalogOnce()

    await requestCatalogOnce()
    await requestCatalogOnce()

    expect(loadCatalogIndex).toHaveBeenCalledTimes(1)
  })

  it('fetches again after a failed load', async () => {
    loadCatalogIndex.mockResolvedValueOnce(failedLoad).mockResolvedValueOnce(successfulLoad)
    const requestCatalogOnce = await freshRequestCatalogOnce()

    expect(await requestCatalogOnce()).toBe(failedLoad)
    expect(await requestCatalogOnce()).toBe(successfulLoad)
    expect(loadCatalogIndex).toHaveBeenCalledTimes(2)
  })
})
