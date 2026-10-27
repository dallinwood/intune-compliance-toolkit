import { describe, expect, it } from 'vitest'
import {
  buildMappingIndex,
  groupMappedRules,
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
  it('writes an implements pair under both rules, outgoing from `from` and incoming to `to`', () => {
    const { index, logged } = build({ 'a.json': mappingFile('a', [link('implements', ['mscp.a'], ['ism.x'], 'Only part.')]) })

    expect(logged).toEqual([])
    expect(index).toEqual({
      schema_version: 1,
      by_rule: {
        'ism.x': [
          { rule: 'mscp.a', relation: 'implements', direction: 'incoming', mapping: 'a', note: 'Only part.', release: 'r1', self_release: 'r1' },
        ],
        'mscp.a': [
          { rule: 'ism.x', relation: 'implements', direction: 'outgoing', mapping: 'a', note: 'Only part.', release: 'r1', self_release: 'r1' },
        ],
      },
    })
  })

  it('writes a related pair as related on both sides', () => {
    const { index } = build({ 'a.json': mappingFile('a', [link('related', ['mscp.a'], ['ism.x'])]) })

    expect(brief(index.by_rule['mscp.a'])).toEqual(['related related ism.x'])
    expect(brief(index.by_rule['ism.x'])).toEqual(['related related mscp.a'])
    expect(index.by_rule['mscp.a'][0].note).toBeNull()
  })

  it('expands a link to every from and to pair', () => {
    const { index } = build({ 'a.json': mappingFile('a', [link('implements', ['mscp.a', 'mscp.b', 'mscp.c'], ['ism.x', 'ism.y'])]) })

    expect(brief(index.by_rule['ism.x'])).toEqual(['implements incoming mscp.a', 'implements incoming mscp.b', 'implements incoming mscp.c'])
    expect(brief(index.by_rule['ism.y'])).toHaveLength(3)
    expect(brief(index.by_rule['mscp.b'])).toEqual(['implements outgoing ism.x', 'implements outgoing ism.y'])
  })

  it('carries each side its own release', () => {
    const value = mappingFile('a', [{ relation: 'implements', from: [endpoint('mscp.a', 'old')], to: [endpoint('ism.x', 'new')] }])
    const { index } = build({ 'a.json': value })

    expect(index.by_rule['mscp.a'][0]).toMatchObject({ release: 'new', self_release: 'old' })
    expect(index.by_rule['ism.x'][0]).toMatchObject({ release: 'old', self_release: 'new' })
  })

  it('sorts rules and entries (relation, then rule id) whatever order the files give them in', () => {
    const files = {
      'b.json': mappingFile('b', [link('related', ['ism.x'], ['mscp.z']), link('implements', ['mscp.b'], ['ism.x'])]),
      'a.json': mappingFile('a', [link('partially_implements', ['mscp.a'], ['ism.x']), link('implements', ['mscp.c'], ['ism.x'])]),
    }
    const { index } = build(files)

    expect(Object.keys(index.by_rule)).toEqual(['ism.x', 'mscp.a', 'mscp.b', 'mscp.c', 'mscp.z'])
    expect(brief(index.by_rule['ism.x'])).toEqual([
      'implements incoming mscp.b',
      'implements incoming mscp.c',
      'partially_implements incoming mscp.a',
      'related related mscp.z',
    ])
    expect(JSON.stringify(build(files).index)).toBe(JSON.stringify(index))
  })

  it('skips an invalid file or a reused id with a log line and keeps the rest', () => {
    const { index, logged } = build({
      'a.json': mappingFile('a', [link('implements', ['mscp.a'], ['ism.x'])]),
      'b.json': mappingFile('b', [link('supersedes', ['mscp.b'], ['ism.x'])]),
      'c.json': mappingFile('a', [link('related', ['mscp.c'], ['ism.x'])]),
      'd.json': { ...mappingFile('d', [link('related', ['mscp.d'], ['ism.x'])]), extra: true },
      'e.json': mappingFile('e', [{ relation: 'related', from: [], to: [endpoint('ism.x')] }]),
    })

    expect(brief(index.by_rule['ism.x'])).toEqual(['implements incoming mscp.a'])
    expect(logged).toHaveLength(4)
    expect(logged.every((message) => message.endsWith('It was skipped.'))).toBe(true)
    expect(logged[1]).toContain('c.json: id a is already used by a.json')
  })

  it('skips a self-link and a pair already defined, in either direction', () => {
    const { index, logged } = build({
      'a.json': mappingFile('a', [
        link('implements', ['mscp.a'], ['ism.x']),
        link('related', ['ism.x'], ['mscp.a']),
        link('related', ['ism.y'], ['ism.y']),
      ]),
    })

    expect(brief(index.by_rule['mscp.a'])).toEqual(['implements outgoing ism.x'])
    expect(index.by_rule['ism.y']).toBeUndefined()
    expect(logged).toHaveLength(2)
  })

  it('gives an empty index for no files', () => {
    expect(build({}).index).toEqual({ schema_version: 1, by_rule: {} })
  })
})

describe('parseMappingIndex', () => {
  it('reads a built index', () => {
    const { index } = build({ 'a.json': mappingFile('a', [link('implements', ['mscp.a'], ['ism.x'])]) })
    const parsed = parseMappingIndex(JSON.parse(JSON.stringify(index)))

    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.warnings).toEqual([])
    expect(parsed.byRule.get('ism.x')).toEqual([
      { rule: 'mscp.a', relation: 'implements', direction: 'incoming', mapping: 'a', note: null, release: 'r1', selfRelease: 'r1' },
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

function mapped(rule: string, relation: MappedRule['relation'], direction: MappedRule['direction']): MappedRule {
  return { rule, relation, direction, mapping: 'm', note: null, release: 'r1', selfRelease: 'r1' }
}

describe('linksWithinLibrary', () => {
  it('drops rules, and links to rules, the library does not have', () => {
    const byRule = new Map([
      ['ism.x', [mapped('mscp.a', 'implements', 'incoming'), mapped('mscp.gone', 'implements', 'incoming')]],
      ['mscp.gone', [mapped('ism.x', 'implements', 'outgoing')]],
      ['ism.y', [mapped('mscp.gone', 'related', 'related')]],
    ])

    const kept = linksWithinLibrary(byRule, new Set(['ism.x', 'ism.y', 'mscp.a']))

    expect([...kept.keys()]).toEqual(['ism.x'])
    expect(kept.get('ism.x')?.map((link) => link.rule)).toEqual(['mscp.a'])
  })
})

describe('wording and grouping', () => {
  it('words each relation from this rule\'s side', () => {
    expect(mappingGroupLabel('implements', 'outgoing')).toBe('Implements')
    expect(mappingGroupLabel('implements', 'incoming')).toBe('Implemented by')
    expect(mappingGroupLabel('partially_implements', 'outgoing')).toBe('Partially implements')
    expect(mappingGroupLabel('partially_implements', 'incoming')).toBe('Partially implemented by')
    expect(mappingGroupLabel('related', 'related')).toBe('Related')
  })

  it('groups links in a fixed order, leaving out empty groups and keeping link order', () => {
    const groups = groupMappedRules([
      mapped('ism.b', 'related', 'related'),
      mapped('ism.a', 'implements', 'outgoing'),
      mapped('mscp.y', 'implements', 'incoming'),
      mapped('mscp.z', 'implements', 'incoming'),
    ])

    expect(groups.map((group) => [group.label, group.links.map((link) => link.rule)])).toEqual([
      ['Implements', ['ism.a']],
      ['Implemented by', ['mscp.y', 'mscp.z']],
      ['Related', ['ism.b']],
    ])
  })
})

describe('staleEndpoints', () => {
  const link = { ...mapped('ism.x', 'implements', 'outgoing'), release: 'v1', selfRelease: 'release_26.0' }

  it('names each end checked against another release than the loaded one', () => {
    expect(
      staleEndpoints(link, { ruleId: 'mscp.a', sourceName: 'mscp', releaseTag: 'release_27.0' }, { sourceName: 'asd_ism', releaseTag: 'v2' }),
    ).toEqual([
      { ruleId: 'mscp.a', sourceName: 'mscp', mappedRelease: 'release_26.0', currentRelease: 'release_27.0' },
      { ruleId: 'ism.x', sourceName: 'asd_ism', mappedRelease: 'v1', currentRelease: 'v2' },
    ])
  })

  it('is empty when both ends match', () => {
    expect(
      staleEndpoints(link, { ruleId: 'mscp.a', sourceName: 'mscp', releaseTag: 'release_26.0' }, { sourceName: 'asd_ism', releaseTag: 'v1' }),
    ).toEqual([])
  })
})
