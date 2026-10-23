import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndexEntry } from '../types/library'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function overlayFile(id: string, fields: Record<string, unknown>) {
  return { schema_version: 1, id, targets: [{ rule: 'asd_ism.ism-1622', release: 'v2026.09.4' }], fields }
}

function serve(files: Record<string, Response | (() => Response)>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const fileName = url.split('/').pop() ?? ''
      const response = files[fileName]
      if (response === undefined) return new Response('missing', { status: 404, statusText: 'Not Found' })
      return typeof response === 'function' ? response() : response
    }),
  )
}

// fetchOverlays caches per session, so each test loads a fresh module.
async function loadFetchOverlays() {
  return (await import('./overlays')).fetchOverlays
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchOverlays', () => {
  it('loads no overlays and no warnings from an empty manifest', async () => {
    serve({ '_manifest.json': jsonResponse({ files: [] }) })
    expect(await (await loadFetchOverlays())()).toEqual({ overlays: [], warnings: [] })
  })

  it('loads the listed files in manifest order, skipping invalid ones and duplicate ids with a warning each', async () => {
    serve({
      '_manifest.json': jsonResponse({ files: ['a.json', 'b.json', 'c.json', 'd.json', 'e.json'] }),
      'a.json': jsonResponse(overlayFile('first', { tags: ['a'] })),
      'b.json': jsonResponse(overlayFile('bad-tags', { tags: 'a' })),
      'c.json': jsonResponse(overlayFile('first', { tags: ['c'] })),
      'd.json': new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      'e.json': jsonResponse(overlayFile('second', { title: 'Two' })),
    })

    const { overlays, warnings } = await (await loadFetchOverlays())()

    expect(overlays.map((overlay) => overlay.id)).toEqual(['first', 'second'])
    expect(warnings).toEqual([
      expect.stringMatching(/^b\.json: tags must be a list value, got a string\. It was skipped\.$/),
      'c.json: id first is already used by a.json. It was skipped.',
      'd.json: expected JSON but got text/html. It was skipped.',
    ])
  })

  it('never rejects: a missing manifest is a warning and no overlays', async () => {
    serve({})
    const { overlays, warnings } = await (await loadFetchOverlays())()

    expect(overlays).toEqual([])
    expect(warnings).toEqual([expect.stringContaining('overlays/_manifest.json: 404 Not Found')])
  })

  it('never rejects when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    const { overlays, warnings } = await (await loadFetchOverlays())()

    expect(overlays).toEqual([])
    expect(warnings).toEqual([expect.stringContaining('Failed to fetch')])
  })
})

describe('overlaysFittingIndex', () => {
  const entry: IndexEntry = {
    id: 'asd_ism.ism-1622',
    title: 'Upstream title',
    file: 'rules/ism-1622.json',
    section: 'Guidelines for system hardening',
    section_path: ['Guidelines for system hardening'],
    assessment: { status: 'manual', manual_reason: 'no_check' },
    architecture: null,
    applicability: [],
    tags: [],
    has_odv: false,
  }

  it('skips an overlay that does not fit an index entry it targets, ignoring missing targets', async () => {
    const { overlaysFittingIndex } = await import('./overlays')
    const fits = { id: 'fits', targets: [{ rule: 'asd_ism.ism-0000', release: 'v1' }, { rule: entry.id, release: 'v1' }], fields: { tags: ['a'] } }
    const misfit = { id: 'misfit', targets: [{ rule: entry.id, release: 'v1' }], fields: { odv: { recommended: 5 } } }

    const result = overlaysFittingIndex({ overlays: [fits, misfit], warnings: ['earlier'] }, new Map([[entry.id, entry]]))

    expect(result.overlays).toEqual([fits])
    expect(result.warnings).toEqual(['earlier', expect.stringMatching(/^Overlay misfit: asd_ism\.ism-1622: odv: .* It was skipped\.$/)])
  })
})
