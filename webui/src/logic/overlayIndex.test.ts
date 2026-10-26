import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { IndexEntry } from '../types/library'
import { buildOverlayIndex, indexFieldsOf, indexLevelOverlays, parseOverlayIndex, reduceOdv } from './overlayIndex'
import { applyOverlayToCheckedIndexEntry, applyOverlayToIndexEntry } from './overlays'

function overlay(id: string, fields: Record<string, unknown>, rules: string[] = ['asd_ism.ism-1622']) {
  return { schema_version: 1, id, targets: rules.map((rule) => ({ rule, release: 'v1' })), fields }
}

const COMPLETE_ODV = {
  by_benchmark: {},
  datatype: 'integer',
  description: 'd',
  recommended: 1,
  validation: { type: 'range', min: 0, max: 9 },
}

const ENTRY: IndexEntry = {
  id: 'asd_ism.ism-1622',
  title: 'Upstream',
  file: 'rules/x.json',
  section: 'S',
  section_path: ['S'],
  assessment: { status: 'manual', manual_reason: 'no_check' },
  architecture: null,
  applicability: [{ target: null, version: null, benchmarks: [{ name: 'b', severity: null }] }],
  tags: [],
  has_odv: false,
}

describe('buildOverlayIndex', () => {
  it('keeps the given file order, lists each rule once per overlay in that order, and logs nothing for good files', () => {
    const logged: string[] = []
    const index = buildOverlayIndex(
      [
        { fileName: 'a.json', value: overlay('a', { tags: ['a'] }, ['r.one', 'r.two', 'r.one']) },
        { fileName: 'b.json', value: overlay('b', { title: 'B' }, ['r.two']) },
      ],
      (message) => logged.push(message),
    )

    expect(index.schema_version).toBe(1)
    expect(index.overlays.map((entry) => [entry.id, entry.file])).toEqual([
      ['a', 'rules/a.json'],
      ['b', 'rules/b.json'],
    ])
    expect(index.by_rule).toEqual({ 'r.one': ['a'], 'r.two': ['a', 'b'] })
    expect(logged).toEqual([])
  })

  it('keeps only the fields an index entry carries', () => {
    const index = buildOverlayIndex(
      [
        {
          fileName: 'a.json',
          value: overlay('a', {
            title: 'T',
            discussion: 'long text',
            tags: { $append: ['x'] },
            references: { nist: ['AC-1'] },
            remediation: { Windows: { steps: [], payloads: [] } },
            section_path: ['One', 'Two'],
            assessment: { status: 'automated', manual_reason: null },
            architecture: 'arm64',
            applicability: [{ target: null, version: null, benchmarks: [] }],
          }),
        },
      ],
      () => {},
    )

    expect(Object.keys(index.overlays[0].index_fields)).toEqual(['title', 'tags', 'section_path', 'assessment', 'architecture', 'applicability'])
    expect(index.overlays[0].index_fields.tags).toEqual({ $append: ['x'] })
  })

  it('skips a structurally invalid file and a reused id, logging each', () => {
    const logged: string[] = []
    const index = buildOverlayIndex(
      [
        { fileName: 'a.json', value: overlay('a', { tags: ['a'] }) },
        { fileName: 'b.json', value: overlay('b', { tags: 'not a list' }) },
        { fileName: 'c.json', value: overlay('a', { tags: ['c'] }) },
        { fileName: 'd.json', value: 'not an object' },
        { fileName: 'e.json', value: overlay('e', { title: 'E' }) },
      ],
      (message) => logged.push(message),
    )

    expect(index.overlays.map((entry) => entry.id)).toEqual(['a', 'e'])
    expect(logged).toEqual([
      'b.json: tags must be a list value, got a string. It was skipped.',
      'c.json: id a is already used by a.json. It was skipped.',
      'd.json: an overlay must be a JSON object. It was skipped.',
    ])
  })

  it('gives an empty index for no files', () => {
    expect(buildOverlayIndex([], () => {})).toEqual({ schema_version: 1, overlays: [], by_rule: {} })
  })
})

describe('odv in the index', () => {
  it('reduces every value to true and keeps the wrapper', () => {
    expect(reduceOdv(COMPLETE_ODV)).toEqual({ by_benchmark: true, datatype: true, description: true, recommended: true, validation: true })
    expect(reduceOdv({ $replace: COMPLETE_ODV })).toEqual({ $replace: { by_benchmark: true, datatype: true, description: true, recommended: true, validation: true } })
    expect(reduceOdv({ $merge: { recommended: 2 } })).toEqual({ $merge: { recommended: true } })
    expect(reduceOdv({ $replace: null })).toEqual({ $replace: null })
    expect(indexFieldsOf({ odv: null })).toEqual({ odv: null })
  })

  // has_odv must match what the full merge gives, so the reduced value has
  // to behave like the original on both a rule with an odv and one without.
  const CASES: [string, unknown][] = [
    ['a complete odv', COMPLETE_ODV],
    ['a replace with a complete odv', { $replace: COMPLETE_ODV }],
    ['a replace with null', { $replace: null }],
    ['a partial merge', { $merge: { recommended: 2 } }],
    ['a partial plain object', { description: 'only' }],
    ['null', null],
  ]
  it.each(CASES)('gives the same has_odv and error as the full overlay for %s', (_name, odv) => {
    for (const hasOdv of [false, true]) {
      const entry = { ...ENTRY, has_odv: hasOdv }
      const outcome = (fields: Record<string, unknown>) => {
        try {
          return applyOverlayToCheckedIndexEntry(entry, fields).has_odv
        } catch (error) {
          return (error as Error).message
        }
      }
      expect(outcome({ odv: reduceOdv(odv) })).toEqual(outcome({ odv }))
    }
  })

  it('applyOverlayToIndexEntry sees the reduced odv like the full one', () => {
    expect(applyOverlayToIndexEntry(ENTRY, { odv: reduceOdv({ $replace: COMPLETE_ODV }) }).has_odv).toBe(true)
  })
})

describe('parseOverlayIndex', () => {
  it('round-trips a built index into startup overlays', () => {
    const built = buildOverlayIndex([{ fileName: 'a.json', value: overlay('a', { title: 'T', discussion: 'x' }) }], () => {})
    const parsed = parseOverlayIndex(built)
    if (typeof parsed === 'string') throw new Error(parsed)

    expect(indexLevelOverlays(parsed.overlays)).toEqual([{ id: 'a', targets: [{ rule: 'asd_ism.ism-1622', release: 'v1' }], fields: { title: 'T' } }])
    expect(parsed.byRule.get('asd_ism.ism-1622')).toEqual(['a'])
  })

  it('drops an entry whose index_fields fail the overlay checks, and a repeated id (first wins)', () => {
    const built = buildOverlayIndex([{ fileName: 'a.json', value: overlay('a', { tags: ['a'] }) }], () => {})
    const [good] = built.overlays
    const parsed = parseOverlayIndex({
      ...built,
      overlays: [
        good,
        { ...good, id: 'bad-tags', file: 'rules/bad-tags.json', index_fields: { tags: 'not a list' } },
        { ...good, id: 'bad-wrapper', file: 'rules/bad-wrapper.json', index_fields: { tags: { $replace: [], $append: [] } } },
        { ...good, file: 'rules/again.json', index_fields: { tags: ['other'] } },
      ],
    })
    if (typeof parsed === 'string') throw new Error(parsed)

    expect(parsed.overlays.map((entry) => [entry.id, entry.file])).toEqual([['a', 'rules/a.json']])
    expect(parsed.warnings).toEqual([
      'Overlay index entry bad-tags: tags must be a list value, got a string. It was skipped.',
      expect.stringMatching(/^Overlay index entry bad-wrapper: tags: a wrapper object must have exactly one key/),
      'Overlay index entry a: the id is already used by an earlier entry. It was skipped.',
    ])
  })

  it('refuses a file with the wrong version or shape', () => {
    expect(typeof parseOverlayIndex({ schema_version: 2, overlays: [], by_rule: {} })).toBe('string')
    expect(typeof parseOverlayIndex({ schema_version: 1, overlays: {}, by_rule: {} })).toBe('string')
    expect(typeof parseOverlayIndex(null)).toBe('string')
  })
})

describe('the committed overlays', () => {
  it('all index cleanly and every target gets its overlay in by_rule', () => {
    const directory = new URL('../../../baselines/_overlays/rules/', import.meta.url)
    const fileNames = readdirSync(directory).filter((name) => name.endsWith('.json')).sort()
    const files = fileNames.map((fileName) => ({ fileName, value: JSON.parse(readFileSync(new URL(fileName, directory), 'utf8')) as unknown }))
    const logged: string[] = []

    const index = buildOverlayIndex(files, (message) => logged.push(message))

    expect(logged).toEqual([])
    expect(index.overlays.map((entry) => entry.file)).toEqual(fileNames.map((name) => `rules/${name}`))
    for (const entry of index.overlays) {
      for (const target of entry.targets) expect(index.by_rule[target.rule]).toContain(entry.id)
    }
  })
})
