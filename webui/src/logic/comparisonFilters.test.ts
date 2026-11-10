import { describe, expect, it } from 'vitest'
import { comparisonFacetCounts, filterComparison, type ComparisonFilters } from './comparisonFilters'
import type { ReleaseComparison, RuleComparison } from './historyIndex'
import type { ChangeKind } from './ruleChanges'

function entry(id: string, overrides: Partial<RuleComparison> = {}): RuleComparison {
  return { id, title: `Title of ${id}`, section: 'os', benchmarks: [], kinds: [], ...overrides }
}

const comparison: ReleaseComparison = {
  added: [entry('mscp.added_one', { title: 'A brand new rule', section: 'auth', benchmarks: ['cis_lvl1'] })],
  removed: [entry('mscp.removed_one', { title: 'A dropped rule', section: 'os' })],
  changed: [
    entry('mscp.reworded', { title: 'Gatekeeper wording', kinds: ['wording'], benchmarks: ['cis_lvl1', 'disa_stig'] }),
    entry('mscp.behaviour', { title: 'Sudo timeout', kinds: ['behaviour', 'scope'], section: 'auth', benchmarks: ['disa_stig'] }),
    entry('mscp.refs', { title: 'Only references', kinds: ['references'] }),
  ],
  unchanged: [entry('mscp.same_one', { section: 'auth', benchmarks: ['cis_lvl1'] }), entry('mscp.same_two', { title: 'Sudo unchanged' })],
}

const everything: ComparisonFilters = {
  kinds: new Set<ChangeKind>(['behaviour', 'scope', 'wording', 'references']),
  search: '',
  sections: [],
  benchmarks: [],
  onlyRuleIds: null,
}

const ids = (entries: RuleComparison[]) => entries.map((candidate) => candidate.id)

describe('filterComparison', () => {
  it('keeps everything when nothing is narrowed', () => {
    expect(filterComparison(comparison, everything)).toEqual(comparison)
  })

  it('keeps a changed rule only when it has any selected kind', () => {
    const result = filterComparison(comparison, { ...everything, kinds: new Set<ChangeKind>(['scope', 'wording']) })

    expect(ids(result.changed)).toEqual(['mscp.reworded', 'mscp.behaviour'])
  })

  it('does not apply the kind filter to added and removed rules', () => {
    const result = filterComparison(comparison, { ...everything, kinds: new Set<ChangeKind>(['references']) })

    expect(ids(result.added)).toEqual(['mscp.added_one'])
    expect(ids(result.removed)).toEqual(['mscp.removed_one'])
    expect(ids(result.changed)).toEqual(['mscp.refs'])
  })

  it('searches the id and the title, ignoring case', () => {
    expect(ids(filterComparison(comparison, { ...everything, search: 'GATEKEEPER' }).changed)).toEqual(['mscp.reworded'])
    expect(ids(filterComparison(comparison, { ...everything, search: 'removed_one' }).removed)).toEqual(['mscp.removed_one'])
    expect(filterComparison(comparison, { ...everything, search: 'no such rule' })).toMatchObject({ added: [], removed: [], changed: [] })
  })

  it('narrows to the given sections', () => {
    const result = filterComparison(comparison, { ...everything, sections: ['auth'] })

    expect(ids(result.added)).toEqual(['mscp.added_one'])
    expect(ids(result.removed)).toEqual([])
    expect(ids(result.changed)).toEqual(['mscp.behaviour'])
  })

  it('narrows to rules listing any of the given benchmarks', () => {
    const result = filterComparison(comparison, { ...everything, benchmarks: ['cis_lvl1'] })

    expect(ids(result.added)).toEqual(['mscp.added_one'])
    expect(ids(result.changed)).toEqual(['mscp.reworded'])
  })

  it('narrows to the given rule ids, and an empty set keeps nothing', () => {
    expect(ids(filterComparison(comparison, { ...everything, onlyRuleIds: new Set(['mscp.behaviour', 'mscp.removed_one']) }).changed)).toEqual(['mscp.behaviour'])
    expect(filterComparison(comparison, { ...everything, onlyRuleIds: new Set() })).toMatchObject({ added: [], removed: [], changed: [] })
  })

  it('narrows the unchanged rules like the others, and the kind filter leaves them alone', () => {
    expect(ids(filterComparison(comparison, { ...everything, kinds: new Set<ChangeKind>(['behaviour']) }).unchanged)).toEqual(['mscp.same_one', 'mscp.same_two'])
    expect(ids(filterComparison(comparison, { ...everything, sections: ['auth'] }).unchanged)).toEqual(['mscp.same_one'])
    expect(ids(filterComparison(comparison, { ...everything, benchmarks: ['cis_lvl1'] }).unchanged)).toEqual(['mscp.same_one'])
    expect(ids(filterComparison(comparison, { ...everything, search: 'sudo' }).unchanged)).toEqual(['mscp.same_two'])
    expect(ids(filterComparison(comparison, { ...everything, onlyRuleIds: new Set(['mscp.same_two']) }).unchanged)).toEqual(['mscp.same_two'])
  })

  it('combines every filter', () => {
    const result = filterComparison(comparison, { ...everything, search: 'rule', sections: ['os'], kinds: new Set<ChangeKind>(['wording']) })

    expect(ids(result.removed)).toEqual(['mscp.removed_one'])
    expect(result.changed).toEqual([])
  })
})

describe('comparisonFacetCounts', () => {
  it('counts changed rules per kind, with every filter but the kinds applied', () => {
    const counts = comparisonFacetCounts(comparison, { ...everything, kinds: new Set<ChangeKind>(['wording']) })

    expect(counts.kinds).toEqual({ behaviour: 1, scope: 1, wording: 1, references: 1 })
    expect(comparisonFacetCounts(comparison, { ...everything, sections: ['auth'] }).kinds).toEqual({ behaviour: 1, scope: 1, wording: 0, references: 0 })
  })

  it('counts rules per section, with every filter but the sections applied', () => {
    const counts = comparisonFacetCounts(comparison, { ...everything, sections: ['auth'], kinds: new Set<ChangeKind>(['wording']) })

    expect(Object.fromEntries(counts.sections)).toEqual({ auth: 1, os: 2 })
  })

  it('counts rules per benchmark, with every filter but the benchmarks applied', () => {
    const counts = comparisonFacetCounts(comparison, { ...everything, benchmarks: ['cis_lvl1'] })

    expect(Object.fromEntries(counts.benchmarks)).toEqual({ cis_lvl1: 2, disa_stig: 2 })
  })
})
