import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { IndexEntry, Rule } from '../types/library'
import {
  FIELD_KINDS,
  INDEX_OVERLAY_FIELDS,
  PROTECTED_FIELDS,
  applyOverlayFields,
  applyOverlays,
  applyOverlaysToIndexEntry,
  applyOverlayToIndexEntry,
  InvalidOverlayError,
  parseOverlay,
  type Overlay,
} from './overlays'
import { inlineRule } from './testRuleFixtures'

interface MergeCase {
  name: string
  rule: Record<string, unknown>
  fields: Record<string, unknown>
  known_fields?: string[]
  expected?: Record<string, unknown>
  error?: true
}

interface IndexCase {
  name: string
  entry: IndexEntry
  fields: Record<string, unknown>
  expected?: IndexEntry
  error?: true
}

// The same file tests/test_overlays.py runs, so the two merges cannot drift.
const CASES = JSON.parse(
  readFileSync(new URL('../../../tests/fixtures/overlays/cases.json', import.meta.url), 'utf8'),
) as { merge_cases: MergeCase[]; index_cases: IndexCase[] }

const clone = <T>(value: T): T => structuredClone(value)

describe('shared merge cases', () => {
  it.each(CASES.merge_cases.map((mergeCase) => [mergeCase.name, mergeCase] as const))('%s', (_name, mergeCase) => {
    const ruleBefore = clone(mergeCase.rule)
    const fieldsBefore = clone(mergeCase.fields)
    const knownFields = mergeCase.known_fields ? new Set(mergeCase.known_fields) : undefined

    if (mergeCase.error) {
      expect(() => applyOverlayFields(mergeCase.rule, mergeCase.fields, knownFields)).toThrow(InvalidOverlayError)
    } else {
      expect(applyOverlayFields(mergeCase.rule, mergeCase.fields, knownFields)).toEqual(mergeCase.expected)
    }
    expect(mergeCase.rule).toEqual(ruleBefore)
    expect(mergeCase.fields).toEqual(fieldsBefore)
  })
})

describe('shared index cases', () => {
  it.each(CASES.index_cases.map((indexCase) => [indexCase.name, indexCase] as const))('%s', (_name, indexCase) => {
    const entryBefore = clone(indexCase.entry)

    if (indexCase.error) {
      expect(() => applyOverlayToIndexEntry(indexCase.entry, indexCase.fields)).toThrow(InvalidOverlayError)
    } else {
      expect(applyOverlayToIndexEntry(indexCase.entry, indexCase.fields)).toEqual(indexCase.expected)
    }
    expect(indexCase.entry).toEqual(entryBefore)
  })
})

it('the merged result shares no objects with its inputs', () => {
  const rule = { id: 'x.rule', tags: ['a'], references: { nist: ['AC-1'] } }
  const fields = { tags: ['b'], check: { $replace: { by_version: {} } } }

  const merged = applyOverlayFields(rule, fields) as Record<string, any>
  merged.tags.push('mutated')
  merged.references.nist.push('mutated')
  merged.check.by_version.mutated = true

  expect(rule).toEqual({ id: 'x.rule', tags: ['a'], references: { nist: ['AC-1'] } })
  expect(fields.check).toEqual({ $replace: { by_version: {} } })
})

const ISM_1622 = 'asd_ism.ism-1622'
const CURRENT_RELEASE = 'v2026.09.4'

function overlayFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    id: 'custom-guidance',
    targets: [{ rule: ISM_1622, release: CURRENT_RELEASE }],
    fields: { tags: ['powershell'] },
    ...overrides,
  }
}

describe('parseOverlay', () => {
  it('accepts a well-formed overlay and keeps only id, targets and fields', () => {
    const parsed = parseOverlay(overlayFile({ description: 'Shown nowhere yet.' }), 'custom.json')

    expect(parsed).toEqual({
      overlay: { id: 'custom-guidance', targets: [{ rule: ISM_1622, release: CURRENT_RELEASE }], fields: { tags: ['powershell'] } },
    })
  })

  it('accepts unknown field names, which are ignored when applied', () => {
    expect(parseOverlay(overlayFile({ fields: { not_a_rule_field: 1 } }), 'custom.json')).toHaveProperty('overlay')
  })

  const invalidFiles: [string, unknown][] = [
    ['a non-object', ['not', 'an', 'overlay']],
    ['a wrong schema_version', overlayFile({ schema_version: 2 })],
    ['a boolean schema_version', overlayFile({ schema_version: true })],
    ['an id with capitals', overlayFile({ id: 'Bad_Id' })],
    ['a missing id', overlayFile({ id: undefined })],
    ['a non-string description', overlayFile({ description: 3 })],
    ['empty targets', overlayFile({ targets: [] })],
    ['a target without a release', overlayFile({ targets: [{ rule: ISM_1622 }] })],
    ['a target with an extra key', overlayFile({ targets: [{ rule: ISM_1622, release: CURRENT_RELEASE, note: 'x' }] })],
    ['fields that are a list', overlayFile({ fields: ['tags'] })],
    ['an unexpected top-level key', overlayFile({ field: {} })],
    ['a protected field', overlayFile({ fields: { source: { release_tag: 'v1' } } })],
    ['a $replace wrapper with two keys', overlayFile({ fields: { references: { $replace: {}, $append: [] } } })],
    ['an unknown wrapper', overlayFile({ fields: { tags: { $prepend: ['a'] } } })],
    ['a nested unknown wrapper', overlayFile({ fields: { references: { nist: { $bogus: [] } } } })],
    ['$append with a non-list', overlayFile({ fields: { tags: { $append: 'a' } } })],
    ['$merge with a non-object', overlayFile({ fields: { references: { $merge: [] } } })],
    ['a $ key inside a $merge value', overlayFile({ fields: { references: { $merge: { $replace: {} } } } })],
    ['tags that are a string', overlayFile({ fields: { tags: 'powershell' } })],
    ['tags replaced by an object', overlayFile({ fields: { tags: { $replace: { a: 1 } } } })],
    ['a title that is a list', overlayFile({ fields: { title: ['x'] } })],
    ['references that are a list', overlayFile({ fields: { references: ['x'] } })],
    ['a check that is a string', overlayFile({ fields: { check: 'echo' } })],
    ['a __proto__ key', JSON.parse('{"schema_version":1,"id":"proto","targets":[{"rule":"asd_ism.ism-1622","release":"v1"}],"fields":{"references":{"__proto__":{"x":1}}}}')],
  ]

  it.each(invalidFiles)('rejects %s, naming the file', (_description, value) => {
    const parsed = parseOverlay(value, 'broken.json')

    expect(parsed).toHaveProperty('error')
    expect((parsed as { error: string }).error).toMatch(/^broken\.json: /)
  })

  it('accepts null where a field may be null and an object where it may be one', () => {
    const fields = { check: null, odv: { $replace: null }, remediation: { $replace: { default: { shell: null, additional_info: null } } }, architecture: null }
    expect(parseOverlay(overlayFile({ fields }), 'custom.json')).toHaveProperty('overlay')
  })
})

function overlay(id: string, fields: Record<string, unknown>, release = CURRENT_RELEASE, rule = ISM_1622): Overlay {
  return { id, targets: [{ rule, release }], fields }
}

function odvWithValidation(validation: Record<string, unknown>) {
  return { datatype: 'enum', description: 'Value', validation, recommended: '1', by_benchmark: {} }
}

function ism1622Rule(overrides: Partial<Rule> = {}): Rule {
  const rule = inlineRule({ upstreamId: 'ism-1622', releaseTag: CURRENT_RELEASE, overrides: { check: null, ...overrides } })
  return { ...rule, id: ISM_1622, source: { ...rule.source, name: 'asd_ism' } }
}

describe('applyOverlays', () => {
  it('returns the rule untouched with no provenance when no overlay targets it', () => {
    const rule = ism1622Rule()
    const result = applyOverlays(rule, [overlay('elsewhere', { title: 'x' }, CURRENT_RELEASE, 'mscp.other_rule')], CURRENT_RELEASE)

    expect(result.rule).toBe(rule)
    expect(result.provenance.size).toBe(0)
    expect(result.applied).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it('merges the overlays in order and records the last writer of each top-level field', () => {
    const rule = ism1622Rule({ tags: ['upstream'] })
    const result = applyOverlays(
      rule,
      [overlay('first', { title: 'One', tags: ['a'] }), overlay('second', { title: 'Two', references: { microsoft: ['m'] } }, 'v2025.01.1')],
      CURRENT_RELEASE,
    )

    expect(result.rule.title).toBe('Two')
    expect(result.rule.tags).toEqual(['upstream', 'a'])
    expect(result.rule.references).toEqual({ microsoft: ['m'] })
    expect(Object.fromEntries(result.provenance)).toEqual({
      title: { overlayId: 'second', release: 'v2025.01.1', stale: true },
      tags: { overlayId: 'first', release: CURRENT_RELEASE, stale: false },
      references: { overlayId: 'second', release: 'v2025.01.1', stale: true },
    })
    expect(result.applied).toEqual([
      { overlayId: 'first', release: CURRENT_RELEASE, stale: false },
      { overlayId: 'second', release: 'v2025.01.1', stale: true },
    ])
  })

  it('compares releases as plain strings', () => {
    const result = applyOverlays(ism1622Rule(), [overlay('prefixed', { tags: ['a'] }, '2026.09.4')], CURRENT_RELEASE)
    expect(result.applied[0].stale).toBe(true)
  })

  it('ignores unknown field names, leaving them out of the rule and the provenance', () => {
    const result = applyOverlays(ism1622Rule(), [overlay('unknown', { not_a_rule_field: 1, tags: ['a'] })], CURRENT_RELEASE)

    expect(result.rule).not.toHaveProperty('not_a_rule_field')
    expect([...result.provenance.keys()]).toEqual(['tags'])
  })

  it('skips an overlay that does not fit this rule and still applies the others', () => {
    const result = applyOverlays(
      ism1622Rule(),
      [overlay('append-to-title', { title: { $append: ['x'] } }), overlay('fine', { tags: ['a'] })],
      CURRENT_RELEASE,
    )

    expect(result.rule.title).toBe('Rule ism-1622')
    expect(result.rule.tags).toEqual(['a'])
    expect(result.skipped).toEqual([{ overlayId: 'append-to-title', message: expect.stringContaining('title') }])
    expect(result.applied.map((applied) => applied.overlayId)).toEqual(['fine'])
  })

  it('fills a null check from a complete partial object', () => {
    const entry = { shell: 'echo ok', result: null, additional_info: null }
    const result = applyOverlays(ism1622Rule(), [overlay('check', { check: { default: entry, by_version: {} } })], CURRENT_RELEASE)

    expect(result.skipped).toEqual([])
    expect(result.rule.check).toEqual({ default: entry, by_version: {} })
  })

  const malformedResults: [string, Record<string, unknown>, Partial<Rule>][] = [
    ['an applicability entry without benchmarks', { applicability: [{ target: null, version: null }] }, {}],
    ['a remediation without its required keys', { remediation: { $replace: {} } }, {}],
    ['a check without by_version', { check: { $replace: { default: { shell: 'echo', result: null, additional_info: null } } } }, {}],
    ['a by_version check that is null', { check: { by_version: { '14.0': null } } }, { check: { default: null, by_version: {} } }],
    ['a tag that is not a string', { tags: [3] }, {}],
    ['an incomplete odv', { odv: { recommended: 5 } }, {}],
    ['an assessment with an unknown status', { assessment: { status: 'sometimes' } }, {}],
    ['odv enumValues that are not a list', { odv: { $replace: odvWithValidation({ enumValues: { a: 1 } }) } }, {}],
    ['odv enumValues that are not strings', { odv: { $replace: odvWithValidation({ enumValues: [1] }) } }, {}],
    ['an odv min that is a string', { odv: { $replace: odvWithValidation({ min: '5' }) } }, {}],
    ['an odv regex that is a number', { odv: { $replace: odvWithValidation({ regex: 5 }) } }, {}],
    ['an unknown odv validation key', { odv: { $replace: odvWithValidation({ pattern: 'x' }) } }, {}],
  ]

  it('accepts an odv validation with each known key', () => {
    const odv = odvWithValidation({ min: 1, max: 9, regex: '^[0-9]+$', enumValues: ['1', '2'] })
    const result = applyOverlays(ism1622Rule(), [overlay('odv', { odv: { $replace: odv } })], CURRENT_RELEASE)

    expect(result.skipped).toEqual([])
    expect(result.rule.odv).toEqual(odv)
  })

  it.each(malformedResults)('skips an overlay whose result has %s', (_description, fields, overrides) => {
    const rule = ism1622Rule(overrides)
    const result = applyOverlays(rule, [overlay('malformed', fields)], CURRENT_RELEASE)

    expect(result.rule).toEqual(rule)
    expect(result.skipped.map((skipped) => skipped.overlayId)).toEqual(['malformed'])
  })

  it('adding a check leaves the assessment alone', () => {
    const check = { default: { shell: 'echo ok', result: null, additional_info: null }, by_version: {} }
    const rule = ism1622Rule({ assessment: { status: 'manual', manual_reason: 'no_check' } })

    const result = applyOverlays(rule, [overlay('check', { check: { $replace: check } })], CURRENT_RELEASE)

    expect(result.rule.check).toEqual(check)
    expect(result.rule.assessment).toEqual({ status: 'manual', manual_reason: 'no_check' })
  })
})

describe('applyOverlaysToIndexEntry', () => {
  const entry: IndexEntry = {
    id: ISM_1622,
    title: 'Upstream title',
    file: 'rules/ism-1622.json',
    section: 'Guidelines for system hardening',
    section_path: ['Guidelines for system hardening', 'PowerShell'],
    assessment: { status: 'manual', manual_reason: 'no_check' },
    architecture: null,
    applicability: [],
    tags: [],
    has_odv: false,
  }

  it('applies only the overlays targeting the entry, in order, and recomputes section', () => {
    const result = applyOverlaysToIndexEntry(entry, [
      overlay('first', { title: 'One', tags: ['a'], section_path: { $replace: ['Custom section'] } }),
      overlay('elsewhere', { title: 'Not this rule' }, CURRENT_RELEASE, 'mscp.other_rule'),
      overlay('second', { title: 'Two', discussion: 'Not an index field' }),
    ])

    expect(result).toEqual({ ...entry, title: 'Two', tags: ['a'], section: 'Custom section', section_path: ['Custom section'] })
  })

  it('returns the same entry when nothing targets it', () => {
    expect(applyOverlaysToIndexEntry(entry, [overlay('elsewhere', { title: 'x' }, CURRENT_RELEASE, 'mscp.other_rule')])).toBe(entry)
  })

  it('skips and reports an overlay that does not fit the entry', () => {
    const skipped: string[] = []
    const result = applyOverlaysToIndexEntry(
      entry,
      [overlay('bad', { tags: { $merge: {} } }), overlay('bad-shape', { applicability: [{ target: null }] }), overlay('good', { tags: ['a'] })],
      (skippedOverlay) => skipped.push(skippedOverlay.overlayId),
    )

    expect(result.tags).toEqual(['a'])
    expect(skipped).toEqual(['bad', 'bad-shape'])
  })
})

describe('overlayable fields follow the v4 schemas', () => {
  const schemaProperties = (name: string, pick: (schema: any) => Record<string, unknown>) =>
    Object.keys(pick(JSON.parse(readFileSync(new URL(`../../../baselines/_${name}.schema.json`, import.meta.url), 'utf8')))).sort()

  it('FIELD_KINDS lists every rule field except the protected ones', () => {
    const ruleFields = schemaProperties('rule', (schema) => schema.properties).filter((field) => !PROTECTED_FIELDS.has(field))
    expect(Object.keys(FIELD_KINDS).sort()).toEqual(ruleFields)
  })

  it('INDEX_OVERLAY_FIELDS lists every index field an overlay can set, plus odv standing in for has_odv', () => {
    const derivedOrProtected = new Set(['id', 'file', 'section', 'has_odv'])
    const indexFields = schemaProperties('index', (schema) => schema.properties.rules.items.properties).filter(
      (field) => !derivedOrProtected.has(field),
    )
    expect([...INDEX_OVERLAY_FIELDS].sort()).toEqual([...indexFields, 'odv'].sort())
  })
})
