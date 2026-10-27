import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function serve(response: () => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response()),
  )
}

describe('loadCatalogIndex', () => {
  it('resolves to a warning and no index when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))))
    const { loadCatalogIndex } = await import('./catalog')

    const loaded = await loadCatalogIndex()

    expect(loaded.index).toBeNull()
    expect(loaded.warning).toContain('offline')
  })

  it('resolves to a warning and no index when the file is not a catalog index', async () => {
    serve(() => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const { loadCatalogIndex } = await import('./catalog')

    const loaded = await loadCatalogIndex()

    expect(loaded.index).toBeNull()
    expect(loaded.warning).toBeTruthy()
  })

  it('returns the index when the file is valid', async () => {
    const index = { schema_version: 1, vendors: [], products: [], licences: [], by_product: {} }
    serve(() => new Response(JSON.stringify(index), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const { loadCatalogIndex } = await import('./catalog')

    expect(await loadCatalogIndex()).toEqual({ index, warning: null })
  })
})
