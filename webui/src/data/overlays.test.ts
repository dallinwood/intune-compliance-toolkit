import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inlineRule } from '../logic/testRuleFixtures'
import type { IndexEntry, ManifestSource, Rule } from '../types/library'

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
    expect(await (await loadFetchOverlays())()).toEqual({ overlays: [], warnings: [], fileNameById: new Map() })
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

// The four overlays the review found crashing the app before the load-time
// dry run: each passes the file checks, and each would break rendering or
// generation once merged.
const CRASHING_FIELDS: Record<string, Record<string, unknown>> = {
  'applicability-without-benchmarks.json': { applicability: [{ target: null, version: null }] },
  'empty-remediation.json': { remediation: { $replace: { Windows: {} } } },
  'check-without-by-version.json': { check: { $replace: { Windows: { language: 'powershell', default: { shell: 'echo', result: null, additional_info: null } } } } },
  'null-by-version-check.json': { check: { macOS: { by_version: { '14.0': null } } } },
}

function loadedFrom(files: Record<string, Record<string, unknown>>) {
  const overlays = Object.entries(files).map(([fileName, fields]) => ({
    id: fileName.replace('.json', ''),
    targets: [{ rule: ISM_1622, release: 'v2026.09.4' }],
    fields,
  }))
  return { overlays, warnings: [] as string[], fileNameById: new Map(overlays.map((overlay) => [overlay.id, `${overlay.id}.json`])) }
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('overlaysFittingLibrary', () => {
  it('drops each crashing overlay with a warning naming its file and rule, and keeps the good one', async () => {
    const { overlaysFittingLibrary } = await import('./overlays')
    const { buildRuleRows } = await import('./ruleRows')
    const target = {
      entry: ENTRY,
      rule: ism1622Rule({ check: { macOS: { language: 'bash', default: null, by_version: {} } } }),
      buildRow: (entry: IndexEntry) => {
        buildRuleRows(ISM_SOURCE, { schema_version: 5, source: 'asd_ism', rules: [entry] })
      },
    }

    const result = overlaysFittingLibrary(loadedFrom({ ...CRASHING_FIELDS, 'z-good.json': { tags: ['a'] } }), new Map([[ISM_1622, target]]))

    expect(result.overlays.map((overlay) => overlay.id)).toEqual(['z-good'])
    expect(result.warnings).toHaveLength(4)
    for (const fileName of Object.keys(CRASHING_FIELDS)) {
      expect(result.warnings).toContainEqual(
        expect.stringMatching(new RegExp(`^${escapeForRegExp(fileName)}: asd_ism\\.ism-1622: .*It was skipped\\.$`)),
      )
    }
  })

  it('drops an overlay for every target when it fails for one, and ignores a missing target', async () => {
    const { overlaysFittingLibrary } = await import('./overlays')
    const otherId = 'asd_ism.ism-1623'
    const otherRule = { ...ism1622Rule(), id: otherId, discussion: 'x' }
    const targets = new Map([
      [ISM_1622, { entry: ENTRY, rule: ism1622Rule(), buildRow: () => {} }],
      [otherId, { entry: { ...ENTRY, id: otherId }, rule: otherRule, buildRow: () => {} }],
    ])
    const loaded = loadedFrom({})
    loaded.overlays.push({
      id: 'half-fits',
      targets: [
        { rule: 'asd_ism.ism-0000', release: 'v1' },
        { rule: ISM_1622, release: 'v1' },
        { rule: otherId, release: 'v1' },
      ],
      fields: { tags: ['fits'], discussion: { $append: ['x'] } },
    })

    const result = overlaysFittingLibrary(loaded, targets)

    expect(result.overlays).toEqual([])
    expect(result.warnings).toEqual([expect.stringContaining('asd_ism.ism-1622: discussion: cannot append')])
  })

  it('keeps an overlay whose rule file could not be loaded, warning that the full rule went unchecked', async () => {
    const { overlaysFittingLibrary } = await import('./overlays')
    const target = { entry: ENTRY, rule: null, buildRow: () => {} }

    const result = overlaysFittingLibrary(loadedFrom({ 'a-tags.json': { tags: ['a'] } }), new Map([[ISM_1622, target]]))

    expect(result.overlays.map((overlay) => overlay.id)).toEqual(['a-tags'])
    expect(result.warnings).toEqual(['a-tags.json: asd_ism.ism-1622: the rule could not be loaded to check this overlay against it.'])
  })

  it('checks each overlay against the result of the ones before it', async () => {
    const { overlaysFittingLibrary } = await import('./overlays')
    const target = { entry: ENTRY, rule: ism1622Rule(), buildRow: () => {} }

    const result = overlaysFittingLibrary(
      loadedFrom({
        'a-check.json': { check: { Windows: { language: 'powershell', default: { shell: 'echo', result: null, additional_info: null }, by_version: {} } } },
        'b-extend-check.json': { check: { Windows: { by_version: { '15.0': { shell: 'echo 15', result: null, additional_info: null } } } } },
        'c-break-check.json': { check: { Windows: { by_version: { '16.0': { shell: 'echo 16' } } } } },
      }),
      new Map([[ISM_1622, target]]),
    )

    expect(result.overlays.map((overlay) => overlay.id)).toEqual(['a-check', 'b-extend-check'])
    expect(result.warnings).toEqual([expect.stringMatching(/^c-break-check\.json: asd_ism\.ism-1622: check\.Windows\.by_version\.16\.0 is missing result/)])
  })
})

describe('loadLibrary with crashing overlays', () => {
  it('still loads the library, applying the good overlay and warning about the rest', async () => {
    const rule = ism1622Rule()
    const overlayFiles: Record<string, unknown> = Object.fromEntries(
      Object.entries({ ...CRASHING_FIELDS, 'z-good.json': { title: 'Custom title' } }).map(([fileName, fields]) => [
        fileName,
        overlayFile(fileName.replace('.json', ''), fields),
      ]),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/baselines/_manifest.json')) return jsonResponse({ schema_version: 5, sources: [ISM_SOURCE] })
        if (url.endsWith('/baselines/asd_ism/_index.json')) return jsonResponse({ schema_version: 5, source: 'asd_ism', rules: [ENTRY] })
        if (url.endsWith('/baselines/asd_ism/rules/ism-1622.json')) return jsonResponse(rule)
        if (url.endsWith('/overlays/_manifest.json')) return jsonResponse({ files: Object.keys(overlayFiles).sort() })
        const fileName = url.split('/').pop() ?? ''
        return fileName in overlayFiles ? jsonResponse(overlayFiles[fileName]) : new Response('missing', { status: 404 })
      }),
    )
    const { loadLibrary } = await import('./ruleRows')
    const { fetchRule } = await import('./ruleDetail')

    const library = await loadLibrary()

    expect(library.rows.map((row) => row.title)).toEqual(['Custom title'])
    expect(library.overlayWarnings).toHaveLength(4)
    const overlaid = await fetchRule({ id: ISM_1622, path: 'asd_ism/rules/ism-1622.json' })
    expect(overlaid.title).toBe('Custom title')
    expect(overlaid.check).toBeNull()
  })
})
