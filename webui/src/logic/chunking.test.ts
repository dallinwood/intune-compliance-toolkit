import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Odv, Rule } from '../types/library'
import { serializeRulesJson } from './bundleFiles'
import { classifyRule, packChunks, type ClassificationResult, type GeneratableRule } from './chunking'
import { generateBashScript } from './scriptGen/bash'
import { createSelectionEntry, type OrgDefinedValue, type SelectionEntry } from './selectionEntry'
import { inlineRule, numberOdv, ruleCheck, type InlineRuleOptions } from './testRuleFixtures'
import { committedVocabularyIndex, vocabularyIndexOf } from './testVocabularyFixtures'

const COVERED_VERSIONS = ['27.0', '26.0', '15.0']
const vocabularyIndex = committedVocabularyIndex()
const RULES_DIRECTORY = new URL('../../../baselines/mscp/rules/', import.meta.url)

function realRule(upstreamId: string): Rule {
  return JSON.parse(readFileSync(new URL(`${upstreamId}.json`, RULES_DIRECTORY), 'utf8')) as Rule
}

function selectionFor(rule: Rule, odvValue: OrgDefinedValue | null = null): SelectionEntry {
  return { ...createSelectionEntry({ id: rule.id, path: `mscp/rules/${rule.source.upstream_rule_id}.json` }), enabled: true, odvValue }
}

function classify(rule: Rule, odvValue: OrgDefinedValue | null = null): ClassificationResult {
  return classifyRule(rule, selectionFor(rule, odvValue), COVERED_VERSIONS, vocabularyIndex)
}

function expectGeneratable(result: ClassificationResult): GeneratableRule {
  if (result.kind !== 'generatable') throw new Error(`Expected generatable, got ${result.kind}: ${JSON.stringify(result)}`)
  return result.rule
}

function odvRule(odv: Odv, title = 'Require a Minimum Password Length of $ODV Characters'): Rule {
  return inlineRule({
    upstreamId: 'pwpolicy_example_length',
    section: 'pwpolicy',
    overrides: {
      title,
      odv,
      check: { default: ruleCheck('echo $ODV', { type: 'integer', value: '$ODV' }), by_version: {} },
    },
  })
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

function generatable(options: InlineRuleOptions = {}): GeneratableRule {
  return expectGeneratable(classify(inlineRule(options)))
}

function generatableWithShell(upstreamId: string, shell: string): GeneratableRule {
  return generatable({ upstreamId, overrides: { check: { default: ruleCheck(shell, { type: 'string', value: 'PASS' }), by_version: {} } } })
}

function numbered(count: number, section = 'os'): GeneratableRule[] {
  return Array.from({ length: count }, (_, index) =>
    generatable({ upstreamId: `${section}_rule_${String(index + 1).padStart(3, '0')}`, section }),
  )
}

describe('classifyRule', () => {
  it('classifies an automated rule with a check as generatable, with its section, source and Intune entry', () => {
    const rule = generatable({ upstreamId: 'auth_example', section: 'auth', releaseTag: 'release_26.0' })

    expect(rule).toMatchObject({
      id: 'mscp.auth_example',
      title: 'Rule auth_example',
      section: 'auth',
      sourceName: 'mscp',
      releaseTag: 'release_26.0',
    })
    expect(rule.plan.settingName).toBe('auth_example')
    expect(rule.ruleEntry).toMatchObject({ SettingName: 'auth_example', Operator: 'IsEquals', DataType: 'String', Operand: 'PASS' })
  })

  it('classifies a rule mSCP assesses manually as manual with its reason text', () => {
    const rule = inlineRule({ overrides: { assessment: { status: 'manual', manual_reason: 'inherent' }, check: null } })

    expect(classify(rule)).toEqual({
      kind: 'manual',
      entry: { id: rule.id, title: rule.title, reason: 'Met by macOS by design (mSCP: inherent).', additionalInfo: null },
    })
  })

  it("carries a manual rule's check additional_info alongside its reason", () => {
    const result = classify(realRule('pwpolicy_temporary_or_emergency_accounts_disable'))

    if (result.kind !== 'manual') throw new Error(`Expected manual, got ${result.kind}`)
    expect(result.entry.reason).toBe('mSCP marks this check as manual.')
    expect(result.entry.additionalInfo).toMatch(/^Verify if a password policy is enforced by a directory service/)
  })

  it('classifies a manual rule before looking at its ODV, so a manual rule is never blocked', () => {
    const rule = inlineRule({
      overrides: { assessment: { status: 'manual', manual_reason: 'manual' }, odv: numberOdv({ recommended: null as unknown as number }) },
    })

    expect(classify(rule, "12'").kind).toBe('manual')
  })

  it('generates an ODV rule from the recommended value when the admin has entered nothing', () => {
    const rule = expectGeneratable(classify(odvRule(numberOdv({ recommended: 6 }))))

    expect(rule.plan.odvValue).toBe(6)
    expect(rule.ruleEntry).toMatchObject({ DataType: 'Int64', Operand: 6 })
    expect(rule.title).toBe('Require a Minimum Password Length of 6 Characters')
  })

  it("generates an ODV rule from the admin's stored value over the recommended one", () => {
    const rule = expectGeneratable(classify(odvRule(numberOdv({ recommended: 6 })), 15))

    expect(rule.ruleEntry.Operand).toBe(15)
  })

  it('blocks an ODV rule with no stored value and no recommended value', () => {
    const rule = odvRule(numberOdv({ recommended: null as unknown as number }))

    expect(classify(rule)).toEqual({
      kind: 'blocked',
      entry: { id: rule.id, title: 'Require a Minimum Password Length of [value] Characters', reason: 'Needs an organization value' },
    })
  })

  it('blocks an ODV rule whose stored value is invalid instead of falling back to the recommended value', () => {
    const rule = odvRule(numberOdv({ recommended: 6 }))

    expect(classify(rule, "12'")).toEqual({
      kind: 'blocked',
      entry: {
        id: rule.id,
        title: 'Require a Minimum Password Length of [value] Characters',
        reason: 'Organization value is invalid: Value must be a whole number.',
      },
    })
  })

  it('blocks system_settings_softwareupdate_current on a stored value that date -v cannot use', () => {
    const rule = realRule('system_settings_softwareupdate_current')

    expect(classify(rule, '30d').kind).toBe('generatable')
    for (const unusable of ['30', 'abc']) {
      const result = classify(rule, unusable)
      expect(result.kind).toBe('blocked')
      expect(result.kind === 'blocked' && result.entry.reason).toBe(
        'Organization value is invalid: Value must be a whole number followed by one unit letter (y, m, w, d, H, M or S), for example 30d.',
      )
    }
  })

  it('classifies an automated rule the planner cannot script as manual, with the planner problem as the reason', () => {
    const rule = inlineRule({ overrides: { check: { default: ruleCheck(null, null), by_version: {} } } })

    expect(classify(rule)).toEqual({
      kind: 'manual',
      entry: { id: rule.id, title: rule.title, reason: 'mSCP has no check for macOS 15.0.', additionalInfo: null },
    })
  })

  it('classifies an automated rule mSCP maps to no macOS version as manual', () => {
    const rule = inlineRule({ overrides: { applicability: {} } })

    expect(classify(rule)).toEqual({
      kind: 'manual',
      entry: { id: rule.id, title: rule.title, reason: 'mSCP does not map this rule to any macOS version.', additionalInfo: null },
    })
  })

  it('generates the real pwpolicy_minimum_length_enforce with no admin input', () => {
    const rule = expectGeneratable(classify(realRule('pwpolicy_minimum_length_enforce')))

    expect(rule.section).toBe('pwpolicy')
    expect(rule.title).toBe('Require a Minimum Password Length of 6 Characters')
  })
})

describe('packChunks', () => {
  it('never combines two sections into one chunk, ordering sections as mSCP does', () => {
    const chunks = packChunks([...numbered(1, 'auth'), ...numbered(1, 'os')], vocabularyIndex)

    expect(chunks.map((chunk) => chunk.section)).toEqual(['os', 'auth'])
    expect(chunks.every((chunk) => chunk.partNumber === null)).toBe(true)
  })

  it('orders sections by the vocabulary, then unlisted sections alphabetically, without merging grouped ones', () => {
    const grouped = vocabularyIndexOf({
      sections: [
        { label: 'Auditing', terms: ['audit', 'audit_legacy'] },
        { label: 'Operating system', terms: ['os'] },
      ],
    })
    const chunks = packChunks(
      [...numbered(1, 'zeta'), ...numbered(1, 'os'), ...numbered(1, 'alpha'), ...numbered(1, 'audit_legacy'), ...numbered(1, 'audit')],
      grouped,
    )

    expect(chunks.map((chunk) => chunk.section)).toEqual(['audit', 'audit_legacy', 'os', 'alpha', 'zeta'])
  })

  it('keeps different release tags of the same section in separate chunks', () => {
    const chunks = packChunks(
      [generatable({ upstreamId: 'os_a', releaseTag: 'release_26.0' }), generatable({ upstreamId: 'os_b', releaseTag: 'release_27.0' })],
      vocabularyIndex,
    )

    expect(chunks.map((chunk) => chunk.releaseTag)).toEqual(['release_26.0', 'release_27.0'])
  })

  it('orders rules within a chunk by id and carries one Intune entry per rule', () => {
    const chunks = packChunks([generatable({ upstreamId: 'os_b' }), generatable({ upstreamId: 'os_a' })], vocabularyIndex)

    expect(chunks[0].rules.map((rule) => rule.id)).toEqual(['mscp.os_a', 'mscp.os_b'])
    expect(chunks[0].ruleEntries.map((entry) => entry.SettingName)).toEqual(['os_a', 'os_b'])
  })

  it('splits a section evenly once the rule-count cap is exceeded, numbering the parts', () => {
    const chunks = packChunks(numbered(5), vocabularyIndex, { maxRulesPerChunk: 2 })

    expect(chunks.map((chunk) => chunk.partNumber)).toEqual([1, 2, 3])
    expect(chunks.map((chunk) => chunk.rules.length)).toEqual([2, 2, 1])
  })

  it('redistributes an oversized section evenly by count instead of greedy-filling (180 rules against the 95 cap)', () => {
    const chunks = packChunks(numbered(180), vocabularyIndex)

    expect(chunks.map((chunk) => chunk.rules.length)).toEqual([90, 90])
  })

  it('splits a section once the rules-JSON byte cap is exceeded, measured on the file as written to the bundle', () => {
    const rules = numbered(6)
    // Just under three entries' worth of the written (indented) file, which
    // compact JSON of three or more entries would still fit under.
    const cap = utf8Bytes(serializeRulesJson(rules.slice(0, 3).map((rule) => rule.ruleEntry))) - 1

    const chunks = packChunks(rules, vocabularyIndex, { maxBytesPerChunk: cap })

    expect(chunks.map((chunk) => chunk.rules.length)).toEqual([2, 2, 2])
    for (const chunk of chunks) {
      expect(utf8Bytes(serializeRulesJson(chunk.ruleEntries))).toBeLessThanOrEqual(cap)
    }
  })

  it('splits a section once the discovery-script byte cap is exceeded', () => {
    const bigShell = `echo ${'x'.repeat(3000)} >/dev/null; echo PASS`
    const rules = Array.from({ length: 5 }, (_, index) => generatableWithShell(`os_big_${index}`, bigShell))
    const oneRuleScriptBytes = new TextEncoder().encode(generateBashScript([rules[0].plan])).length
    const cap = oneRuleScriptBytes * 2

    const chunks = packChunks(rules, vocabularyIndex, { maxScriptBytesPerChunk: cap })

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(new TextEncoder().encode(generateBashScript(chunk.rules.map((rule) => rule.plan))).length).toBeLessThanOrEqual(cap)
    }
  })

  it('throws, naming the rule, when one rule alone exceeds a per-chunk limit', () => {
    expect(() => packChunks(numbered(1), vocabularyIndex, { maxScriptBytesPerChunk: 100 })).toThrow(/mscp\.os_rule_001/)
  })

  it('throws when two rules in one chunk would share a SettingName', () => {
    const rules = [generatable({ upstreamId: 'os_a-b' }), generatable({ upstreamId: 'os_a_b' })]

    expect(() => packChunks(rules, vocabularyIndex)).toThrow(/Duplicate SettingName.*os_a_b/)
  })
})
