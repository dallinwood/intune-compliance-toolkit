import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildOverlayIndex } from '../logic/overlayIndex'
import { inlineRule } from '../logic/testRuleFixtures'
import type { IndexEntry, ManifestSource, Rule } from '../types/library'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function overlayFile(id: string, fields: Record<string, unknown>) {
  return { schema_version: 1, id, targets: [{ rule: 'asd_ism.ism-1622', release: 'v2026.09.4' }], fields }
}

// fetchOverlayIndex caches per session, so each test loads a fresh module.
beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function serve(files: Record<string, Response | (() => Response)>) {
  const fetchMock = vi.fn(async (url: string) => {
    const path = url.slice(url.indexOf('/baselines/_overlays/') + '/baselines/_overlays/'.length)
    const response = files[path]
    if (response === undefined) return new Response('missing', { status: 404, statusText: 'Not Found' })
    return typeof response === 'function' ? response() : response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('fetchOverlayIndex', () => {
  it('loads the generated index and nothing else', async () => {
    const index = buildOverlayIndex(
      [
        { fileName: 'a.json', value: overlayFile('first', { tags: ['a'] }) },
        { fileName: 'b.json', value: overlayFile('second', { title: 'Two' }) },
      ],
      () => {},
    )
    const fetchMock = serve({ '_index.json': jsonResponse(index) })
    const { fetchOverlayIndex } = await import('./overlays')

    const loaded = await fetchOverlayIndex()

    expect(loaded.overlays.map((overlay) => overlay.id)).toEqual(['first', 'second'])
    expect(loaded.byRule.get('asd_ism.ism-1622')).toEqual(['first', 'second'])
    expect(loaded.warnings).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never rejects: a missing index is a warning and no overlays', async () => {
    serve({})
    const { fetchOverlayIndex } = await import('./overlays')
    const { overlays, warnings } = await fetchOverlayIndex()

    expect(overlays).toEqual([])
    expect(warnings).toEqual([expect.stringContaining('baselines/_overlays/_index.json: 404 Not Found')])
  })

  it('never rejects when the network fails or the index is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    const { fetchOverlayIndex } = await import('./overlays')
    expect((await fetchOverlayIndex()).warnings).toEqual([expect.stringContaining('Failed to fetch')])

    vi.resetModules()
    serve({ '_index.json': new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } }) })
    const reloaded = await (await import('./overlays')).fetchOverlayIndex()
    expect(reloaded.warnings).toEqual([expect.stringContaining('expected JSON but got text/html')])
  })

  it('warns about a bad index entry and keeps the others', async () => {
    const good = buildOverlayIndex([{ fileName: 'a.json', value: overlayFile('first', { tags: ['a'] }) }], () => {})
    const badEntry = { ...good.overlays[0], id: 'bad', file: '../escape.json' }
    serve({ '_index.json': jsonResponse({ ...good, overlays: [...good.overlays, badEntry] }) })
    const { fetchOverlayIndex } = await import('./overlays')

    const { overlays, warnings } = await fetchOverlayIndex()

    expect(overlays.map((overlay) => overlay.id)).toEqual(['first'])
    expect(warnings).toEqual(['Overlay index entry bad: file must be rules/<name>.json. It was skipped.'])
  })
})

const ISM_1622 = 'asd_ism.ism-1622'
const ISM_SOURCE: ManifestSource = {
  name: 'asd_ism',
  display_name: 'ASD Information Security Manual',
  release_tag: 'v2026.09.4',
  commit_sha: 'a'.repeat(40),
  retrieved_date: '2026-10-23',
  repository_url: 'https://example.test/ism',
  license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', rights_holder: 'ASD', modified: true },
  index_path: 'asd_ism/_index.json',
  rule_count: 1,
}
const ENTRY: IndexEntry = {
  id: ISM_1622,
  title: 'Upstream title',
  file: 'rules/ism-1622.json',
  section: 'Guidelines for system hardening',
  section_path: ['Guidelines for system hardening'],
  assessment: { status: 'manual', manual_reason: 'no_check' },
  architecture: null,
  applicability: [{ target: null, version: null, benchmarks: [{ name: 'ism_protected', severity: null }] }],
  tags: [],
  has_odv: false,
}

function ism1622Rule(overrides: Partial<Rule> = {}): Rule {
  const rule = inlineRule({ upstreamId: 'ism-1622', releaseTag: 'v2026.09.4', overrides: { check: null, remediation: null, ...overrides } })
  return { ...rule, id: ISM_1622, source: { ...rule.source, name: 'asd_ism' } }
}

// Overlays that pass the file checks but would break rendering or generation
// once merged: the index-level ones are skipped at startup, the rule-level
// ones when the rule is opened.
const INDEX_LEVEL_MISFITS: Record<string, Record<string, unknown>> = {
  'applicability-without-benchmarks': { applicability: [{ target: null, version: null }] },
  'incomplete-odv': { odv: { description: 'only a description' } },
}
const RULE_LEVEL_MISFITS: Record<string, Record<string, unknown>> = {
  'empty-remediation': { remediation: { $replace: { Windows: {} } } },
  'check-without-by-version': { check: { $replace: { Windows: { language: 'powershell', default: { shell: 'echo', result: null, additional_info: null } } } } },
}

function serveLibrary(overlays: Record<string, Record<string, unknown>>) {
  const rule = ism1622Rule()
  const overlayFiles = Object.fromEntries(Object.entries(overlays).map(([id, fields]) => [`rules/${id}.json`, overlayFile(id, fields)]))
  const index = buildOverlayIndex(
    Object.entries(overlayFiles).map(([path, value]) => ({ fileName: path.replace('rules/', ''), value })),
    () => {},
  )
  const fetched: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetched.push(url)
      if (url.endsWith('/baselines/_manifest.json')) return jsonResponse({ schema_version: 5, sources: [ISM_SOURCE] })
      if (url.endsWith('/baselines/asd_ism/_index.json')) return jsonResponse({ schema_version: 5, source: 'asd_ism', rules: [ENTRY] })
      if (url.endsWith('/baselines/asd_ism/rules/ism-1622.json')) return jsonResponse(rule)
      if (url.endsWith('/baselines/_overlays/_index.json')) return jsonResponse(index)
      const path = url.slice(url.indexOf('/baselines/_overlays/') + '/baselines/_overlays/'.length)
      return path in overlayFiles ? jsonResponse(overlayFiles[path]) : new Response('missing', { status: 404 })
    }),
  )
  return fetched
}

describe('loadLibrary with lazily loaded overlays', () => {
  it('applies index-level fields at startup without fetching any overlay file or rule', async () => {
    const fetched = serveLibrary({ 'a-title': { title: 'Custom title', tags: ['custom'], remediation: { Windows: { steps: [], payloads: [] } } } })
    const { loadLibrary } = await import('./ruleRows')

    const library = await loadLibrary()

    expect(library.rows.map((row) => row.title)).toEqual(['Custom title'])
    expect(library.rows[0].tags).toEqual(['custom'])
    expect(library.overlayWarnings).toEqual([])
    expect(fetched.filter((url) => url.includes('/rules/'))).toEqual([])
    expect(fetched.some((url) => url.includes('_overlays/') && !url.endsWith('_overlays/_index.json'))).toBe(false)
  })

  it('fetches only the opened rule overlays, once, when the rule is opened', async () => {
    const fetched = serveLibrary({ 'a-title': { title: 'Custom title' }, 'b-tags': { tags: ['b'] } })
    const { loadLibrary } = await import('./ruleRows')
    const { fetchRule } = await import('./ruleDetail')
    await loadLibrary()

    const ref = { id: ISM_1622, path: 'asd_ism/rules/ism-1622.json' }
    const rule = await fetchRule(ref)
    await fetchRule(ref)

    expect(rule.title).toBe('Custom title')
    expect(rule.tags).toEqual(['b'])
    expect(fetched.filter((url) => url.includes('_overlays/rules/'))).toEqual([
      '/baselines/_overlays/rules/a-title.json',
      '/baselines/_overlays/rules/b-tags.json',
    ])
  })

  it('skips an index-level misfit for its rule with a startup warning and keeps the good overlay', async () => {
    serveLibrary({ ...INDEX_LEVEL_MISFITS, 'z-good': { title: 'Custom title' } })
    const { loadLibrary } = await import('./ruleRows')

    const library = await loadLibrary()

    expect(library.rows.map((row) => row.title)).toEqual(['Custom title'])
    expect(library.overlayWarnings).toHaveLength(Object.keys(INDEX_LEVEL_MISFITS).length)
    for (const overlayId of Object.keys(INDEX_LEVEL_MISFITS)) {
      expect(library.overlayWarnings).toContainEqual(expect.stringMatching(new RegExp(`^Overlay ${overlayId}: asd_ism\\.ism-1622: .*It was skipped\\.$`)))
    }
  })

  it('drops a rule-level misfit when the rule is opened, keeping the good overlay', async () => {
    serveLibrary({ ...RULE_LEVEL_MISFITS, 'z-good': { title: 'Custom title' } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { loadLibrary } = await import('./ruleRows')
    const { fetchOverlaidRule } = await import('./ruleDetail')

    const library = await loadLibrary()
    const overlaid = await fetchOverlaidRule({ id: ISM_1622, path: 'asd_ism/rules/ism-1622.json' })

    expect(library.overlayWarnings).toEqual([])
    expect(overlaid.rule.title).toBe('Custom title')
    expect(overlaid.rule.check).toBeNull()
    expect(overlaid.skipped.map((skipped) => skipped.overlayId).sort()).toEqual(Object.keys(RULE_LEVEL_MISFITS).sort())
    expect(warn).toHaveBeenCalledTimes(Object.keys(RULE_LEVEL_MISFITS).length)
    warn.mockRestore()
  })
})
