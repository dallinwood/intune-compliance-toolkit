import { afterEach, describe, expect, it, vi } from 'vitest'
import { inlineRule } from '../logic/testRuleFixtures'
import type { Overlay } from '../logic/overlays'
import type { RuleOverlaySource } from './overlays'
import { fetchOverlaidRule, fetchRule, setRuleOverlays } from './ruleDetail'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

// fetchRule's cache is module-level and lives for the whole file, so every
// test uses its own rule id.
function refFor(upstreamId: string) {
  return { id: `mscp.${upstreamId}`, path: `mscp/rules/${upstreamId}.json` }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchRule', () => {
  it('fetches the rule JSON once and serves later calls from the cache', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'mscp.cached_rule' }))
    vi.stubGlobal('fetch', fetchMock)
    const ref = refFor('cached_rule')

    expect(await fetchRule(ref)).toEqual({ id: 'mscp.cached_rule' })
    expect(await fetchRule(ref)).toEqual({ id: 'mscp.cached_rule' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/baselines/mscp/rules/cached_rule.json')
  })

  it('names the rule and status on an HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404, statusText: 'Not Found' })))

    await expect(fetchRule(refFor('http_error_rule'))).rejects.toThrow(
      'Failed to load rule mscp.http_error_rule (404 Not Found)',
    )
  })

  // Vite's dev server answers a missing file with index.html and a 200.
  it('rejects a non-JSON content type, naming the rule', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } })),
    )

    await expect(fetchRule(refFor('html_fallback_rule'))).rejects.toThrow(
      'Failed to load rule mscp.html_fallback_rule: expected JSON but got text/html',
    )
  })

  it('rejects a body that is not valid JSON, naming the rule', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"id": ', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    )

    await expect(fetchRule(refFor('truncated_rule'))).rejects.toThrow(
      /^Failed to load rule mscp\.truncated_rule: the response is not valid JSON/,
    )
  })

  it('does not cache a failure, so the next call fetches again', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Network down'))
      .mockResolvedValueOnce(jsonResponse({ id: 'mscp.retried_rule' }))
    vi.stubGlobal('fetch', fetchMock)
    const ref = refFor('retried_rule')

    await expect(fetchRule(ref)).rejects.toThrow('Failed to load rule mscp.retried_rule: Network down')
    expect(await fetchRule(ref)).toEqual({ id: 'mscp.retried_rule' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

function sourceOf(overlays: Overlay[], onLoad?: (overlayId: string) => void): RuleOverlaySource {
  return {
    overlayIdsFor: (ruleId) => overlays.filter((overlay) => overlay.targets.some((target) => target.rule === ruleId)).map((overlay) => overlay.id),
    loadOverlay: async (overlayId) => {
      onLoad?.(overlayId)
      const overlay = overlays.find((candidate) => candidate.id === overlayId)
      if (!overlay) throw new Error(`${overlayId}: 404 Not Found`)
      return overlay
    },
  }
}

describe('fetchRule with overlays', () => {
  afterEach(() => {
    setRuleOverlays(sourceOf([]))
  })

  it('returns the overlaid rule to every caller and the provenance to the details', async () => {
    const rule = inlineRule({ upstreamId: 'overlaid_rule', releaseTag: 'release_27.0', overrides: { title: 'Upstream', tags: ['a'] } })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(rule)))
    setRuleOverlays(
      sourceOf([
        { id: 'current', targets: [{ rule: rule.id, release: 'release_27.0' }], fields: { tags: ['b'] } },
        { id: 'older', targets: [{ rule: rule.id, release: 'release_26.0' }], fields: { title: 'Custom' } },
      ]),
    )
    const ref = refFor('overlaid_rule')

    expect(await fetchRule(ref)).toEqual({ ...rule, title: 'Custom', tags: ['a', 'b'] })
    const overlaid = await fetchOverlaidRule(ref)
    expect(Object.fromEntries(overlaid.provenance)).toEqual({
      tags: { overlayId: 'current', release: 'release_27.0', stale: false },
      title: { overlayId: 'older', release: 'release_26.0', stale: true },
    })
  })

  it('loads only the overlays that target the opened rule', async () => {
    const rule = inlineRule({ upstreamId: 'lazy_rule', releaseTag: 'release_27.0' })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(rule)))
    const loaded: string[] = []
    setRuleOverlays(
      sourceOf(
        [
          { id: 'mine', targets: [{ rule: rule.id, release: 'release_27.0' }], fields: { tags: ['b'] } },
          { id: 'elsewhere', targets: [{ rule: 'mscp.other', release: 'release_27.0' }], fields: { tags: ['c'] } },
        ],
        (overlayId) => loaded.push(overlayId),
      ),
    )

    await fetchRule(refFor('lazy_rule'))

    expect(loaded).toEqual(['mine'])
  })

  it('drops an overlay that cannot be loaded or does not fit, for this rule only, with a warning and a skipped entry', async () => {
    const rule = inlineRule({ upstreamId: 'misfit_rule', releaseTag: 'release_27.0', overrides: { tags: ['a'] } })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(rule)))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const target = [{ rule: rule.id, release: 'release_27.0' }]
    const good = { id: 'good', targets: target, fields: { tags: ['b'] } }
    const misfit = { id: 'misfit', targets: target, fields: { tags: { $merge: {} } } }
    const source = sourceOf([good, misfit])
    setRuleOverlays({ ...source, overlayIdsFor: () => ['good', 'misfit', 'missing'] })

    const overlaid = await fetchOverlaidRule(refFor('misfit_rule'))

    expect(overlaid.rule.tags).toEqual(['a', 'b'])
    expect(overlaid.skipped.map((skipped) => skipped.overlayId).sort()).toEqual(['misfit', 'missing'])
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})
