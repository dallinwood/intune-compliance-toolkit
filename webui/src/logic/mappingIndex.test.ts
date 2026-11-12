import { describe, expect, it } from 'vitest'
import type { HistoryIndex } from './historyIndex'
import {
  addChangedKinds,
  buildMappingIndex,
  changedKindsSince,
  linksWithinLibrary,
  mappingGroupLabel,
  parseMappingIndex,
  staleEndpoints,
  type MappedRule,
  type MappingIndexEntry,
} from './mappingIndex'

function endpoint(id: string, release = 'r1') {
  return { kind: 'rule', id, release }
}

function link(relation: string, from: string[], to: string[], note?: string | null) {
  return { relation, from: from.map((id) => endpoint(id)), to: to.map((id) => endpoint(id)), ...(note === undefined ? {} : { note }) }
}

function mappingFile(id: string, links: unknown[]) {
  return { schema_version: 1, id, links }
}

function build(files: Record<string, unknown>) {
  const logged: string[] = []
  const fileNames = Object.keys(files).sort()
  const index = buildMappingIndex(
    fileNames.map((fileName) => ({ fileName, value: files[fileName] })),
    (message) => logged.push(message),
  )
  return { index, logged }
}

function brief(entries: MappingIndexEntry[] | undefined) {
  return (entries ?? []).map((entry) => `${entry.relation} ${entry.direction} ${entry.rule}`)
}

describe('buildMappingIndex', () => {
  it('writes a supports pair under both rules, outgoing from `from` and incoming to `to`', () => {
    const { index, logged } = build({ 'a.json': mappingFile('a', [link('supports', ['mscp.a'], ['ism.x'], 'Only part.')]) })

    expect(logged).toEqual([])
    expect(index).toEqual({
      schema_version: 1,
      by_rule: {
        'ism.x': [
          { rule: 'mscp.a', relation: 'supports', direction: 'incoming', mapping: 'a', note: 'Only part.', release: 'r1', self_release: 'r1' },
        ],
        'mscp.a': [
          { rule: 'ism.x', relation: 'supports', direction: 'outgoing', mapping: 'a', note: 'Only part.', release: 'r1', self_release: 'r1' },
        ],
      },
      mapping_files: { a: { description: null, generated_by: null } },
    })
  })

  it('writes a related pair as related on both sides', () => {
    const { index } = build({ 'a.json': mappingFile('a', [link('related', ['mscp.a'], ['ism.x'])]) })

    expect(brief(index.by_rule['mscp.a'])).toEqual(['related related ism.x'])
    expect(brief(index.by_rule['ism.x'])).toEqual(['related related mscp.a'])
    expect(index.by_rule['mscp.a'][0].note).toBeNull()
  })

  it('expands a link to every from and to pair', () => {
    const { index } = build({ 'a.json': mappingFile('a', [link('supports', ['mscp.a', 'mscp.b', 'mscp.c'], ['ism.x', 'ism.y'])]) })

    expect(brief(index.by_rule['ism.x'])).toEqual(['supports incoming mscp.a', 'supports incoming mscp.b', 'supports incoming mscp.c'])
    expect(brief(index.by_rule['ism.y'])).toHaveLength(3)
    expect(brief(index.by_rule['mscp.b'])).toEqual(['supports outgoing ism.x', 'supports outgoing ism.y'])
  })

  it('carries each side its own release', () => {
    const value = mappingFile('a', [{ relation: 'supports', from: [endpoint('mscp.a', 'old')], to: [endpoint('ism.x', 'new')] }])
    const { index } = build({ 'a.json': value })

    expect(index.by_rule['mscp.a'][0]).toMatchObject({ release: 'new', self_release: 'old' })
    expect(index.by_rule['ism.x'][0]).toMatchObject({ release: 'old', self_release: 'new' })
  })

  it('sorts rules and entries (relation, then rule id) whatever order the files give them in', () => {
    const files = {
      'b.json': mappingFile('b', [link('related', ['ism.x'], ['mscp.z']), link('supports', ['mscp.b'], ['ism.x'])]),
      'a.json': mappingFile('a', [link('supports', ['mscp.a'], ['ism.x']), link('supports', ['mscp.c'], ['ism.x'])]),
    }
    const { index } = build(files)

    expect(Object.keys(index.by_rule)).toEqual(['ism.x', 'mscp.a', 'mscp.b', 'mscp.c', 'mscp.z'])
    expect(brief(index.by_rule['ism.x'])).toEqual([
      'related related mscp.z',
      'supports incoming mscp.a',
      'supports incoming mscp.b',
      'supports incoming mscp.c',
    ])
    expect(JSON.stringify(build(files).index)).toBe(JSON.stringify(index))
  })

  it('skips an invalid file or a reused id with a log line and keeps the rest', () => {
    const { index, logged } = build({
      'a.json': mappingFile('a', [link('supports', ['mscp.a'], ['ism.x'])]),
      'b.json': mappingFile('b', [link('supersedes', ['mscp.b'], ['ism.x'])]),
      'c.json': mappingFile('a', [link('related', ['mscp.c'], ['ism.x'])]),
      'd.json': { ...mappingFile('d', [link('related', ['mscp.d'], ['ism.x'])]), extra: true },
      'e.json': mappingFile('e', [{ relation: 'related', from: [], to: [endpoint('ism.x')] }]),
    })

    expect(brief(index.by_rule['ism.x'])).toEqual(['supports incoming mscp.a'])
    expect(logged).toHaveLength(4)
    expect(logged.every((message) => message.endsWith('It was skipped.'))).toBe(true)
    expect(logged[1]).toContain('c.json: id a is already used by a.json')
  })

  it('skips a self-link and a pair already defined, in either direction', () => {
    const { index, logged } = build({
      'a.json': mappingFile('a', [
        link('supports', ['mscp.a'], ['ism.x']),
        link('related', ['ism.x'], ['mscp.a']),
        link('related', ['ism.y'], ['ism.y']),
      ]),
    })

    expect(brief(index.by_rule['mscp.a'])).toEqual(['supports outgoing ism.x'])
    expect(index.by_rule['ism.y']).toBeUndefined()
    expect(logged).toHaveLength(2)
  })

  it('gives an empty index for no files', () => {
    expect(build({}).index).toEqual({ schema_version: 1, by_rule: {}, mapping_files: {} })
  })
})

describe('parseMappingIndex', () => {
  it('reads a built index', () => {
    const { index } = build({ 'a.json': mappingFile('a', [link('supports', ['mscp.a'], ['ism.x'])]) })
    const parsed = parseMappingIndex(JSON.parse(JSON.stringify(index)))

    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.warnings).toEqual([])
    expect(parsed.byRule.get('ism.x')).toEqual([
      { rule: 'mscp.a', relation: 'supports', direction: 'incoming', mapping: 'a', note: null, release: 'r1', selfRelease: 'r1' },
    ])
  })

  it('rejects a file without the schema version or by_rule', () => {
    expect(parseMappingIndex(null)).toBe('schema_version must be 1')
    expect(parseMappingIndex({ schema_version: 2, by_rule: {} })).toBe('schema_version must be 1')
    expect(parseMappingIndex({ schema_version: 1 })).toBe('it needs a by_rule object')
  })

  it('drops a bad entry with a warning and keeps the good ones', () => {
    const good = { rule: 'mscp.a', relation: 'related', direction: 'related', mapping: 'a', note: null, release: 'r', self_release: 'r' }
    const parsed = parseMappingIndex({
      schema_version: 1,
      by_rule: { 'ism.x': [good, { ...good, rule: 'mscp.b', direction: 'outgoing' }], 'ism.y': 'not a list' },
    })

    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.byRule.get('ism.x')?.map((entry) => entry.rule)).toEqual(['mscp.a'])
    expect(parsed.byRule.has('ism.y')).toBe(false)
    expect(parsed.warnings).toHaveLength(2)
  })
})

describe('mapping file provenance', () => {
  const sampleLinks = [link('supports', ['mscp.a'], ['ism.x'])]

  it('round trips generated_by and description through the index, keys sorted', () => {
    const { index } = build({
      'b.json': { ...mappingFile('b', sampleLinks), generated_by: 'python tools/some_generator.py', description: 'Made by a tool' },
      'a.json': mappingFile('a', [link('related', ['mscp.c'], ['ism.y'])]),
    })

    expect(Object.keys(index.mapping_files ?? {})).toEqual(['a', 'b'])
    const parsed = parseMappingIndex(JSON.parse(JSON.stringify(index)))
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.warnings).toEqual([])
    expect(parsed.mappingFiles.get('b')).toEqual({ description: 'Made by a tool', generatedBy: 'python tools/some_generator.py' })
    expect(parsed.mappingFiles.get('a')).toEqual({ description: null, generatedBy: null })
  })

  it('skips a mapping file whose generated_by is empty or not a string', () => {
    for (const generatedBy of ['', 3]) {
      const { index, logged } = build({ 'a.json': { ...mappingFile('a', sampleLinks), generated_by: generatedBy } })
      expect(index.by_rule).toEqual({})
      expect(logged[0]).toContain('generated_by must be a non-empty string')
    }
  })

  it('reads an index without mapping_files as an empty table with no warning', () => {
    const parsed = parseMappingIndex({ schema_version: 1, by_rule: {} })

    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.mappingFiles.size).toBe(0)
    expect(parsed.warnings).toEqual([])
  })

  it('drops a mapping_files that is not an object with a warning and still loads by_rule', () => {
    const good = { rule: 'mscp.a', relation: 'related', direction: 'related', mapping: 'a', note: null, release: 'r', self_release: 'r' }
    const parsed = parseMappingIndex({ schema_version: 1, by_rule: { 'ism.x': [good] }, mapping_files: ['nope'] })

    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.mappingFiles.size).toBe(0)
    expect(parsed.byRule.get('ism.x')).toHaveLength(1)
    expect(parsed.warnings).toHaveLength(1)
  })

  it('drops only the entry of the wrong shape with a warning', () => {
    const parsed = parseMappingIndex({
      schema_version: 1,
      by_rule: {},
      mapping_files: {
        good: { description: null, generated_by: 'cmd' },
        'bad-type': { description: 3, generated_by: null },
        'missing-key': { description: null },
        'not-object': 'x',
      },
    })

    if (typeof parsed === 'string') throw new Error(parsed)
    expect([...parsed.mappingFiles.keys()]).toEqual(['good'])
    expect(parsed.warnings).toHaveLength(3)
  })
})

function mapped(rule: string, relation: MappedRule['relation'], direction: MappedRule['direction']): MappedRule {
  return { rule, relation, direction, mapping: 'm', note: null, release: 'r1', selfRelease: 'r1' }
}

describe('linksWithinLibrary', () => {
  it('drops rules, and links to rules, the library does not have', () => {
    const byRule = new Map([
      ['ism.x', [mapped('mscp.a', 'supports', 'incoming'), mapped('mscp.gone', 'supports', 'incoming')]],
      ['mscp.gone', [mapped('ism.x', 'supports', 'outgoing')]],
      ['ism.y', [mapped('mscp.gone', 'related', 'related')]],
    ])

    const kept = linksWithinLibrary(byRule, new Set(['ism.x', 'ism.y', 'mscp.a']))

    expect([...kept.keys()]).toEqual(['ism.x'])
    expect(kept.get('ism.x')?.map((link) => link.rule)).toEqual(['mscp.a'])
  })
})

describe('wording', () => {
  it('words each relation from this rule\'s side', () => {
    expect(mappingGroupLabel('supports', 'outgoing')).toBe('Supports')
    expect(mappingGroupLabel('supports', 'incoming')).toBe('Supported by')
    expect(mappingGroupLabel('related', 'related')).toBe('Related')
  })
})

describe('staleEndpoints', () => {
  const link = { ...mapped('ism.x', 'supports', 'outgoing'), release: 'v1', selfRelease: 'release_26.0' }
  const self = { ruleId: 'mscp.a', sourceName: 'mscp', releaseTag: 'release_27.0' }
  const other = { sourceName: 'asd_ism', releaseTag: 'v2' }
  const everythingChanged = () => ['wording' as const]

  it('names each end checked against another release than the loaded one, with what changed', () => {
    const changedKindsFor = (ruleId: string) => (ruleId === 'mscp.a' ? ['behaviour' as const] : ['scope' as const, 'wording' as const])

    expect(staleEndpoints(link, self, other, changedKindsFor)).toEqual([
      { ruleId: 'mscp.a', sourceName: 'mscp', mappedRelease: 'release_26.0', currentRelease: 'release_27.0', changedKinds: ['behaviour'] },
      { ruleId: 'ism.x', sourceName: 'asd_ism', mappedRelease: 'v1', currentRelease: 'v2', changedKinds: ['scope', 'wording'] },
    ])
  })

  it('is empty when both ends match', () => {
    expect(staleEndpoints(link, { ...self, releaseTag: 'release_26.0' }, { ...other, releaseTag: 'v1' }, everythingChanged)).toEqual([])
  })

  it('drops an end whose rule did not change since the mapped release', () => {
    const changedKindsFor = (ruleId: string) => (ruleId === 'mscp.a' ? [] : ['wording' as const])

    expect(staleEndpoints(link, self, other, changedKindsFor).map((endpoint) => endpoint.ruleId)).toEqual(['ism.x'])
  })

  it('keeps an end whose mapped release is not in the history, with null kinds', () => {
    expect(staleEndpoints(link, self, other, () => null).map((endpoint) => endpoint.changedKinds)).toEqual([null, null])
  })

  it('passes the rule and the mapped release to the lookup', () => {
    const asked: [string, string][] = []
    staleEndpoints(link, self, other, (ruleId, mappedRelease) => {
      asked.push([ruleId, mappedRelease])
      return null
    })

    expect(asked).toEqual([
      ['mscp.a', 'release_26.0'],
      ['ism.x', 'v1'],
    ])
  })
})

describe('changedKindsSince', () => {
  const fingerprints = (wording: string, behaviour = 'b') => ({ behaviour, scope: 's', wording, references: 'r' })
  const history: HistoryIndex = {
    schema_version: 1,
    source: 'mscp',
    releases: ['R1', 'R2', 'R3'].map((tag) => ({ tag, label: tag, published_date: '2026-01-01', index_path: `mscp/releases/${tag}/_index.json` })),
    rules: {
      'mscp.same': { title: 't', file: 'f', section: 's', benchmarks: [], versions: [fingerprints('w'), fingerprints('w'), fingerprints('w')] },
      'mscp.reworded': { title: 't', file: 'f', section: 's', benchmarks: [], versions: [fingerprints('w1'), fingerprints('w2'), fingerprints('w3')] },
      'mscp.reverted': { title: 't', file: 'f', section: 's', benchmarks: [], versions: [fingerprints('w'), fingerprints('x'), fingerprints('w')] },
      'mscp.late': { title: 't', file: 'f', section: 's', benchmarks: [], versions: [null, null, fingerprints('w')] },
    },
  }

  it('lists the kinds that differ between the mapped release and the newest one', () => {
    expect(changedKindsSince(history, 'mscp.reworded', 'R1')).toEqual(['wording'])
  })

  it('is empty for a rule that is the same, including one whose change was reverted', () => {
    expect(changedKindsSince(history, 'mscp.same', 'R1')).toEqual([])
    expect(changedKindsSince(history, 'mscp.reverted', 'R1')).toEqual([])
  })

  it('is null when the mapped release is not in the history or the rule was not in it', () => {
    expect(changedKindsSince(history, 'mscp.same', 'R0')).toBeNull()
    expect(changedKindsSince(history, 'mscp.late', 'R1')).toBeNull()
    expect(changedKindsSince(history, 'mscp.unknown', 'R1')).toBeNull()
  })
})

describe('addChangedKinds', () => {
  const fingerprints = (wording: string) => ({ behaviour: 'b', scope: 's', wording, references: 'r' })
  const historyOf = (source: string, ruleId: string, versions: (ReturnType<typeof fingerprints> | null)[]): HistoryIndex => ({
    schema_version: 1,
    source,
    releases: versions.map((_, position) => ({ tag: `${source}-${position + 1}`, label: 'l', published_date: '2026-01-01', index_path: `${source}/i.json` })),
    rules: { [ruleId]: { title: 't', file: 'f', section: 's', benchmarks: [], versions } },
  })
  const entry = (rule: string, release: string, selfRelease: string): MappingIndexEntry => ({
    rule,
    relation: 'related',
    direction: 'related',
    mapping: 'm',
    note: null,
    release,
    self_release: selfRelease,
  })

  it('adds the kinds changed since each end that is not on its current release, and only for those ends', () => {
    const histories = [
      historyOf('mscp', 'mscp.a', [fingerprints('old'), fingerprints('new')]),
      historyOf('asd_ism', 'asd_ism.x', [fingerprints('same'), fingerprints('same')]),
    ]
    const index = {
      schema_version: 1 as const,
      by_rule: { 'mscp.a': [entry('asd_ism.x', 'asd_ism-1', 'mscp-2')], 'asd_ism.x': [entry('mscp.a', 'mscp-1', 'asd_ism-2')] },
    }

    const result = addChangedKinds(index, histories)

    expect(result.by_rule['mscp.a'][0]).toEqual({ ...entry('asd_ism.x', 'asd_ism-1', 'mscp-2'), changed_kinds: [] })
    expect(result.by_rule['asd_ism.x'][0]).toEqual({ ...entry('mscp.a', 'mscp-1', 'asd_ism-2'), changed_kinds: ['wording'] })
  })

  it('writes null for a mapped release the history does not hold', () => {
    const histories = [historyOf('mscp', 'mscp.a', [fingerprints('old'), fingerprints('new')])]
    const index = { schema_version: 1 as const, by_rule: { 'asd_ism.x': [entry('mscp.a', 'release_0.0', 'v9')] } }

    expect(addChangedKinds(index, histories).by_rule['asd_ism.x'][0].changed_kinds).toBeNull()
  })

  it('leaves entries alone when no history knows the rule', () => {
    const index = { schema_version: 1 as const, by_rule: { 'x.a': [entry('x.b', 'r1', 'r1')] } }

    expect(addChangedKinds(index, [])).toEqual(index)
  })
})

describe('parseMappingIndex with changed kinds', () => {
  const base = { rule: 'b', relation: 'related', direction: 'related', mapping: 'm', note: null, release: 'r1', self_release: 'r2' }

  it('reads changed_kinds and self_changed_kinds, keeping null and ignoring a missing key', () => {
    const parsed = parseMappingIndex({
      schema_version: 1,
      by_rule: { a: [{ ...base, changed_kinds: ['wording'], self_changed_kinds: null }, base] },
    })

    expect(typeof parsed).not.toBe('string')
    const entries = (parsed as { byRule: Map<string, MappedRule[]> }).byRule.get('a') ?? []
    expect(entries[0]).toMatchObject({ changedKinds: ['wording'], selfChangedKinds: null })
    expect(entries[1].changedKinds).toBeUndefined()
  })

  it('drops an entry whose changed_kinds names an unknown kind', () => {
    const parsed = parseMappingIndex({ schema_version: 1, by_rule: { a: [{ ...base, changed_kinds: ['colour'] }] } })

    expect(typeof parsed === 'string' ? parsed : parsed.warnings).toEqual([expect.stringContaining('changed_kinds')])
  })
})
