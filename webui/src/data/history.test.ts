import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildHistoryIndex } from '../logic/historyIndex'
import { inlineRule } from '../logic/testRuleFixtures'
import type { ManifestSource } from '../types/library'
import { fetchHistoryIndex, fetchRuleAtRelease } from './history'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

const SOURCE = {
  name: 'asd_ism',
  releases: ['v2025.12.9', 'v2026.09.4'].map((tag, position) => ({
    tag,
    label: tag,
    published_date: `2025-1${position}-01`,
    index_path: `asd_ism/releases/${tag}/_index.json`,
  })),
} as unknown as ManifestSource

function indexWithRule() {
  const rule = { ...inlineRule({ upstreamId: 'ism-0359' }), id: 'asd_ism.ism-0359', file: 'rules/ism-0359.json' }
  return buildHistoryIndex(SOURCE, new Map([['v2026.09.4', [rule]]]))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchRuleAtRelease', () => {
  it('fetches the rule file from the folder of the requested release', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'asd_ism.ism-0359' }))
    vi.stubGlobal('fetch', fetchMock)

    const rule = await fetchRuleAtRelease(indexWithRule(), 'asd_ism.ism-0359', 'v2025.12.9')

    expect(rule).toEqual({ id: 'asd_ism.ism-0359' })
    expect(fetchMock).toHaveBeenCalledWith('/baselines/asd_ism/releases/v2025.12.9/rules/ism-0359.json')
  })

  it('rejects a release the index does not list, without fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchRuleAtRelease(indexWithRule(), 'asd_ism.ism-0359', 'v1.0')).rejects.toThrow('v1.0')
    await expect(fetchRuleAtRelease(indexWithRule(), 'asd_ism.unknown', 'v2025.12.9')).rejects.toThrow('asd_ism.unknown')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names the rule and release when the file cannot be loaded, and does not cache the failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('missing', { status: 404, statusText: 'Not Found' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'asd_ism.ism-0359' }))
    vi.stubGlobal('fetch', fetchMock)
    const index = indexWithRule()

    await expect(fetchRuleAtRelease(index, 'asd_ism.ism-0359', 'v2026.09.4')).rejects.toThrow('asd_ism.ism-0359')
    await expect(fetchRuleAtRelease(index, 'asd_ism.ism-0359', 'v2026.09.4')).resolves.toEqual({ id: 'asd_ism.ism-0359' })
  })
})

describe('fetchHistoryIndex', () => {
  it('fetches and parses the history file of a source once', async () => {
    const index = indexWithRule()
    const fetchMock = vi.fn(async () => jsonResponse(index))
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchHistoryIndex('asd_ism')).toEqual(index)
    expect(await fetchHistoryIndex('asd_ism')).toEqual(index)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/baselines/_history/asd_ism.json')
  })

  it('rejects a file that is not a history index', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ schema_version: 99 })))

    await expect(fetchHistoryIndex('broken_source')).rejects.toThrow(/broken_source.*schema_version/)
  })
})
