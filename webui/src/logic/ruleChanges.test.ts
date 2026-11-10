import { describe, expect, it } from 'vitest'
import changeIgnoreFile from '../../../baselines/_change_ignore.json'
import ruleSchema from '../../../baselines/_rule.schema.json'
import type { Rule } from '../types/library'
import {
  CHANGE_KINDS,
  DEFAULT_SHOWN_KINDS,
  FIELD_CHANGE_KIND,
  IGNORED_FIELDS,
  fieldChanges,
  kindFingerprints,
} from './ruleChanges'
import { applicabilityOfVersions, inlineRule, macosCheck, numberOdv, ruleCheck } from './testRuleFixtures'

function withOverrides(overrides: Partial<Rule>): Rule {
  return inlineRule({ overrides })
}

describe('the field lists', () => {
  it('puts every property of the rule schema in exactly one of the ignored list and a change kind', () => {
    const schemaProperties = Object.keys(ruleSchema.properties)
    const problems = schemaProperties.filter((property) => Number(IGNORED_FIELDS.has(property)) + Number(property in FIELD_CHANGE_KIND) !== 1)

    expect(problems).toEqual([])
  })

  it('names no field that is both ignored and given a kind', () => {
    expect(Object.keys(FIELD_CHANGE_KIND).filter((field) => IGNORED_FIELDS.has(field))).toEqual([])
  })

  it('reads the ignored fields from baselines/_change_ignore.json', () => {
    expect([...IGNORED_FIELDS].sort()).toEqual([...changeIgnoreFile.ignored_fields].sort())
    expect([...IGNORED_FIELDS].sort()).toEqual(['file', 'id', 'schema_version', 'source'])
  })

  it('shows behaviour, scope and wording by default, in kind order', () => {
    expect(CHANGE_KINDS).toEqual(['behaviour', 'scope', 'wording', 'references'])
    expect(DEFAULT_SHOWN_KINDS).toEqual(['behaviour', 'scope', 'wording'])
  })
})

describe('fieldChanges', () => {
  it('finds nothing when only the ignored fields differ', () => {
    const before = inlineRule({ releaseTag: 'release_27.0' })
    const after = inlineRule({ releaseTag: 'release_27.1' })
    after.source = { ...after.source, commit_sha: 'def' }

    expect(fieldChanges(before, after)).toEqual([])
    expect(kindFingerprints(before)).toEqual(kindFingerprints(after))
  })

  it('reports a changed check shell as one behaviour change shown as code', () => {
    const before = withOverrides({ check: macosCheck(ruleCheck('echo old', { type: 'string', value: 'PASS' })) })
    const after = withOverrides({ check: macosCheck(ruleCheck('echo new', { type: 'string', value: 'PASS' })) })

    expect(fieldChanges(before, after)).toEqual([
      { kind: 'behaviour', path: ['check', 'macOS', 'default', 'shell'], display: 'code', before: 'echo old', after: 'echo new' },
    ])
  })

  it('reports a changed discussion as a wording change shown as text', () => {
    const changes = fieldChanges(inlineRule(), withOverrides({ discussion: 'Another discussion.' }))

    expect(changes).toEqual([
      { kind: 'wording', path: ['discussion'], display: 'text', before: 'First paragraph.\n\nSecond paragraph.', after: 'Another discussion.' },
    ])
  })

  it('reports a benchmark added to one applicability entry as a scope change shown as a list', () => {
    const before = withOverrides({ applicability: applicabilityOfVersions({ 'macOS 26.0': [], 'macOS 27.0': [{ name: 'cis_lvl1', severity: null }] }) })
    const after = withOverrides({
      applicability: applicabilityOfVersions({
        'macOS 26.0': [],
        'macOS 27.0': [
          { name: 'cis_lvl1', severity: null },
          { name: 'disa_stig', severity: 'high' },
        ],
      }),
    })

    const changes = fieldChanges(before, after)

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: 'scope', path: ['applicability', 'macOS 27.0', 'benchmarks'], display: 'list' })
    expect(changes[0].before).toEqual(['cis_lvl1'])
    expect(changes[0].after).toEqual(['cis_lvl1', 'disa_stig (high)'])
  })

  it('reports an applicability entry that appears or disappears under its own scope', () => {
    const before = withOverrides({ applicability: applicabilityOfVersions({ 'macOS 26.0': [] }) })
    const after = withOverrides({ applicability: applicabilityOfVersions({ 'macOS 26.0': [], 'macOS 27.0': [] }) })

    const changes = fieldChanges(before, after)

    expect(changes.map((change) => [change.kind, change.path, change.before === undefined])).toEqual([['scope', ['applicability', 'macOS 27.0'], true]])
  })

  it('matches remediation steps by position and shows a changed step shell as code', () => {
    const step = (shell: string) => ({ name: null, language: 'bash' as const, shell, additional_info: null, versions: null })
    const before = withOverrides({ remediation: { macOS: { steps: [step('one'), step('two')], payloads: [] } } })
    const after = withOverrides({ remediation: { macOS: { steps: [step('one'), step('three')], payloads: [] } } })

    expect(fieldChanges(before, after)).toEqual([
      { kind: 'behaviour', path: ['remediation', 'macOS', 'steps', '1', 'shell'], display: 'code', before: 'two', after: 'three' },
    ])
  })

  it('shows a changed inline payload as pretty JSON code', () => {
    const payload = (data: Record<string, unknown>) => ({ kind: 'mobileconfig', versions: null, data })
    const before = withOverrides({ remediation: { macOS: { steps: [], payloads: [payload({ a: 1 })] } } })
    const after = withOverrides({ remediation: { macOS: { steps: [], payloads: [payload({ a: 2 })] } } })

    const [change] = fieldChanges(before, after)

    expect(change).toMatchObject({ kind: 'behaviour', path: ['remediation', 'macOS', 'payloads', '0', 'data'], display: 'code' })
    expect(change.before).toBe('{\n  "a": 1\n}')
    expect(change.after).toBe('{\n  "a": 2\n}')
  })

  it('reports a changed tags list as a references change shown as a list', () => {
    const changes = fieldChanges(withOverrides({ tags: ['a'] }), withOverrides({ tags: ['a', 'b'] }))

    expect(changes).toEqual([{ kind: 'references', path: ['tags'], display: 'list', before: ['a'], after: ['a', 'b'] }])
  })

  it('shows a changed number as a plain value', () => {
    const changes = fieldChanges(withOverrides({ odv: numberOdv() }), withOverrides({ odv: numberOdv({ recommended: 8 }) }))

    expect(changes).toEqual([{ kind: 'behaviour', path: ['odv', 'recommended'], display: 'value', before: 6, after: 8 }])
  })

  it('spells out a whole object that appeared, so each part is drawn as its own kind of change', () => {
    const changes = fieldChanges(withOverrides({ check: null }), withOverrides({ check: macosCheck(ruleCheck('echo new', { type: 'string', value: 'PASS' })) }))

    expect(changes).toContainEqual({ kind: 'behaviour', path: ['check', 'macOS', 'default', 'shell'], display: 'code', before: undefined, after: 'echo new' })
    expect(changes.every((change) => change.path[0] === 'check' && change.before === undefined)).toBe(true)
  })

  it('spells out a whole object that disappeared, with the new side undefined', () => {
    const changes = fieldChanges(withOverrides({ odv: numberOdv() }), withOverrides({ odv: null }))

    expect(changes).toContainEqual({ kind: 'behaviour', path: ['odv', 'recommended'], display: 'value', before: 6, after: undefined })
    expect(changes.every((change) => change.path[0] === 'odv' && change.after === undefined)).toBe(true)
  })

  it('draws a whole remediation step that was added as its parts', () => {
    const step = { name: null, language: 'bash' as const, shell: 'echo hi', additional_info: null, versions: null }
    const changes = fieldChanges(
      withOverrides({ remediation: { macOS: { steps: [], payloads: [] } } }),
      withOverrides({ remediation: { macOS: { steps: [step], payloads: [] } } }),
    )

    expect(changes).toContainEqual({ kind: 'behaviour', path: ['remediation', 'macOS', 'steps', '0', 'shell'], display: 'code', before: undefined, after: 'echo hi' })
  })

  it('orders changes by kind and then by path', () => {
    const before = inlineRule()
    const after = withOverrides({ discussion: 'x', tags: ['t'], title: 'New title', architecture: 'arm64' })

    expect(fieldChanges(before, after).map((change) => [change.kind, change.path.join('.')])).toEqual([
      ['behaviour', 'architecture'],
      ['wording', 'discussion'],
      ['wording', 'title'],
      ['references', 'tags'],
    ])
  })

  it('does not report a reordering of applicability entries or benchmarks', () => {
    const before = withOverrides({ applicability: applicabilityOfVersions({ 'macOS 26.0': [], 'macOS 27.0': [] }) })
    const after = withOverrides({ applicability: applicabilityOfVersions({ 'macOS 27.0': [], 'macOS 26.0': [] }) })

    expect(fieldChanges(before, after)).toEqual([])
    expect(kindFingerprints(before)).toEqual(kindFingerprints(after))
  })
})

describe('kindFingerprints', () => {
  it('changes only the references fingerprint when only references change', () => {
    const before = kindFingerprints(inlineRule())
    const after = kindFingerprints(withOverrides({ references: { cis: ['1.1'] } }))

    expect(after.references).not.toBe(before.references)
    expect(after.behaviour).toBe(before.behaviour)
    expect(after.scope).toBe(before.scope)
    expect(after.wording).toBe(before.wording)
  })

  it('does not depend on the key order of an object', () => {
    const before = withOverrides({ references: { a: 1, b: { c: 2, d: 3 } } })
    const after = withOverrides({ references: { b: { d: 3, c: 2 }, a: 1 } })

    expect(kindFingerprints(before)).toEqual(kindFingerprints(after))
  })

  it('agrees with fieldChanges about which kinds changed', () => {
    const before = inlineRule()
    const after = withOverrides({ title: 'New title', check: macosCheck(ruleCheck('echo new', null)) })
    const changedKinds = new Set(fieldChanges(before, after).map((change) => change.kind))
    const fingerprintsBefore = kindFingerprints(before)
    const fingerprintsAfter = kindFingerprints(after)

    expect(CHANGE_KINDS.filter((kind) => fingerprintsBefore[kind] !== fingerprintsAfter[kind]).sort()).toEqual([...changedKinds].sort())
  })
})
