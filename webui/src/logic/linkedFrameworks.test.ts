import { describe, expect, it } from 'vitest'
import type { RuleRow } from '../types/rule-row'
import type { MappedRule } from './mappingIndex'
import { linkedFrameworksByRule } from './linkedFrameworks'
import { matchesFilters, type FilterValues } from './ruleFilters'
import { vocabularyIndexOf } from './testVocabularyFixtures'
import { applicabilityOfVersions } from './testRuleFixtures'

type ByRule = Map<string, MappedRule[]>

const noVocabulary = vocabularyIndexOf({})

function row(id: string, sourceName: string): RuleRow {
  return {
    ref: { id, path: `${sourceName}/rules/${id}.json` },
    title: id,
    targetKeys: [],
    section: 's',
    sectionPath: ['s'],
    sourceName,
    releaseTag: 'r1',
    assessment: { status: 'manual', manual_reason: 'no_check' },
    architecture: null,
    applicability: applicabilityOfVersions({}),
    scopeKeys: [],
    benchmarks: [],
    tags: [],
    hasOdv: false,
    checkTypes: [],
    remediationTypes: [],
  }
}

function link(rule: string, direction: MappedRule['direction']): MappedRule {
  return {
    rule,
    relation: direction === 'related' ? 'related' : 'supports',
    direction,
    mapping: 'm',
    note: null,
    release: 'r1',
    selfRelease: 'r1',
  }
}

function supports(byRule: ByRule, from: string, to: string) {
  byRule.set(from, [...(byRule.get(from) ?? []), link(to, 'outgoing')])
  byRule.set(to, [...(byRule.get(to) ?? []), link(from, 'incoming')])
}

function related(byRule: ByRule, first: string, second: string) {
  byRule.set(first, [...(byRule.get(first) ?? []), link(second, 'related')])
  byRule.set(second, [...(byRule.get(second) ?? []), link(first, 'related')])
}

function emptyFilters(overrides: Partial<FilterValues> = {}): FilterValues {
  return {
    search: '',
    targets: new Set(),
    sources: new Set(),
    versions: new Set(),
    benchmarks: new Set(),
    sections: new Set(),
    tags: new Set(),
    linked: new Set(),
    checks: new Set(),
    remediations: new Set(),
    odvs: new Set(),
    automatable: 'all',
    ...overrides,
  }
}

const mscpRule = row('mscp.a', 'mscp')
const ismRule = row('asd_ism.b', 'asd_ism')
const e4eitRule = row('e4eit.c', 'e4eit')
const secondMscpRule = row('mscp.d', 'mscp')
const rows = [mscpRule, ismRule, e4eitRule, secondMscpRule]

function linkedTo(byRule: ByRule, ruleId: string): string[] {
  return Array.from(linkedFrameworksByRule(rows, byRule, noVocabulary).get(ruleId) ?? []).sort()
}

describe('linkedFrameworksByRule', () => {
  it('links a rule to the framework of a rule it supports', () => {
    const byRule: ByRule = new Map()
    supports(byRule, 'mscp.a', 'asd_ism.b')
    expect(linkedTo(byRule, 'mscp.a')).toEqual(['asd_ism'])
  })

  it('links a rule to the framework of a rule that supports it', () => {
    const byRule: ByRule = new Map()
    supports(byRule, 'asd_ism.b', 'mscp.a')
    expect(linkedTo(byRule, 'mscp.a')).toEqual(['asd_ism'])
  })

  it('links a rule to the framework of a related rule', () => {
    const byRule: ByRule = new Map()
    related(byRule, 'mscp.a', 'e4eit.c')
    expect(linkedTo(byRule, 'mscp.a')).toEqual(['e4eit'])
  })

  it('links a rule to a framework reached in two supports hops', () => {
    const byRule: ByRule = new Map()
    supports(byRule, 'mscp.a', 'e4eit.c')
    supports(byRule, 'e4eit.c', 'asd_ism.b')
    expect(linkedTo(byRule, 'mscp.a')).toEqual(['asd_ism', 'e4eit'])
  })

  it('never links a rule to its own framework', () => {
    const byRule: ByRule = new Map()
    supports(byRule, 'mscp.a', 'mscp.d')
    supports(byRule, 'mscp.d', 'asd_ism.b')
    expect(linkedTo(byRule, 'mscp.a')).toEqual(['asd_ism'])
    expect(linkedTo(byRule, 'mscp.d')).toEqual(['asd_ism'])
  })

  it('computes once per rows, index and mapping index', () => {
    const byRule: ByRule = new Map()
    supports(byRule, 'mscp.a', 'asd_ism.b')
    expect(linkedFrameworksByRule(rows, byRule, noVocabulary)).toBe(linkedFrameworksByRule(rows, byRule, noVocabulary))
  })

  it('filters with OR inside the facet and keeps rules without links out', () => {
    const byRule: ByRule = new Map()
    supports(byRule, 'mscp.a', 'asd_ism.b')
    related(byRule, 'mscp.d', 'e4eit.c')
    const linked = linkedFrameworksByRule(rows, byRule, noVocabulary)
    const idsMatching = (selected: string[]) =>
      rows.filter((candidate) => matchesFilters(candidate, emptyFilters({ linked: new Set(selected) }), noVocabulary, undefined, linked)).map((candidate) => candidate.ref.id)
    expect(idsMatching(['asd_ism'])).toEqual(['mscp.a'])
    expect(idsMatching(['asd_ism', 'e4eit'])).toEqual(['mscp.a', 'mscp.d'])
  })
})
