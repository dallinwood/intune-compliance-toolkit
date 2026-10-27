import { describe, expect, it } from 'vitest'
import type { RuleRow } from '../types/rule-row'
import { matchesFilters, type FilterValues } from './ruleFilters'
import { filtersShowingRule } from './ruleNavigation'
import { applicabilityOfVersions } from './testRuleFixtures'
import { vocabularyIndexOf } from './testVocabularyFixtures'

const index = vocabularyIndexOf({})

const ISM_ROW: RuleRow = {
  ref: { id: 'asd_ism.ism-1622', path: 'asd_ism/rules/ism-1622.json' },
  title: 'PowerShell is configured to use Constrained Language Mode.',
  targetKeys: [],
  section: 'Guidelines for system hardening',
  sectionPath: ['Guidelines for system hardening'],
  sourceName: 'asd_ism',
  releaseTag: 'v2026.09.4',
  assessment: { status: 'manual', manual_reason: 'no_check' },
  architecture: null,
  applicability: applicabilityOfVersions({}),
  scopeKeys: [],
  benchmarks: [],
  tags: [],
  hasOdv: false,
}

function filters(overrides: Partial<FilterValues> = {}): FilterValues {
  return {
    search: 'gatekeeper',
    targets: new Set(),
    sources: new Set(),
    versions: new Set(),
    benchmarks: new Set(),
    sections: new Set(),
    tags: new Set(),
    automatable: 'all',
    ...overrides,
  }
}

describe('filtersShowingRule', () => {
  it('sets the search to the upstream id and keeps filters that do not hide the rule', () => {
    const current = filters({ sources: new Set(['asd_ism', 'mscp']) })

    const next = filtersShowingRule(ISM_ROW, current, index)

    expect(next.search).toBe('ism-1622')
    expect(next.sources).toBe(current.sources)
    expect(matchesFilters(ISM_ROW, next, index)).toBe(true)
  })

  it('clears only the filters that hide the rule', () => {
    const current = filters({ sources: new Set(['mscp']), tags: new Set(['800-53r5_high']), automatable: 'automatable', sections: new Set(['Guidelines for system hardening']) })

    const next = filtersShowingRule(ISM_ROW, current, index)

    expect(next.sources.size).toBe(0)
    expect(next.tags.size).toBe(0)
    expect(next.automatable).toBe('all')
    expect(next.sections).toBe(current.sections)
    expect(matchesFilters(ISM_ROW, next, index)).toBe(true)
  })
})
