import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMappingIndex } from '../logic/mappingIndex'

// fetchMappingIndex caches per session, so each test loads a fresh module.
beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function serveIndex(response: () => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response()),
  )
}

describe('fetchMappingIndex', () => {
  it('loads the generated index', async () => {
    const index = buildMappingIndex(
      [{ fileName: 'a.json', value: { schema_version: 1, id: 'a', links: [{ relation: 'related', from: [{ kind: 'rule', id: 'mscp.a', release: 'r' }], to: [{ kind: 'rule', id: 'ism.x', release: 'v' }] }] } }],
      () => {},
    )
    serveIndex(() => new Response(JSON.stringify(index), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const { fetchMappingIndex } = await import('./mappings')

    const loaded = await fetchMappingIndex()

    expect(loaded.warnings).toEqual([])
    expect(loaded.byRule.get('ism.x')?.map((link) => link.rule)).toEqual(['mscp.a'])
  })

  it('never rejects: a missing, HTML or broken index is a warning and no mappings', async () => {
    const responses = [
      () => new Response('missing', { status: 404, statusText: 'Not Found' }),
      () => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      () => new Response('{ broken', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      () => new Response(JSON.stringify({ schema_version: 9 }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ]
    for (const response of responses) {
      vi.resetModules()
      serveIndex(response)
      const { fetchMappingIndex } = await import('./mappings')

      const loaded = await fetchMappingIndex()

      expect(loaded.byRule.size).toBe(0)
      expect(loaded.warnings).toEqual([expect.stringContaining('Rule mappings could not be loaded (baselines/_mappings/_index.json: ')])
    }
  })
})
