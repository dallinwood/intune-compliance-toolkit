import { describe, expect, it } from 'vitest'
import type { RuleRow } from '../types/rule-row'
import type { MappedRule } from './mappingIndex'
import { statusKeyGroups } from './ruleStatusKey'
import { targetIconFor } from './targetIcons'

function rowFor(ruleId: string, overrides: Partial<RuleRow> = {}): RuleRow {
  const sourceName = ruleId.slice(0, ruleId.indexOf('.'))
  return {
    ref: { id: ruleId, path: `${sourceName}/rules/${ruleId}.json` },
    title: `Title of ${ruleId}`,
    targetKeys: ['macOS'],
    section: 'os',
    sectionPath: ['os'],
    sourceName,
    releaseTag: 'r1',
    assessment: { status: 'automated', manual_reason: null },
    architecture: null,
    applicability: [],
    scopeKeys: [],
    benchmarks: [],
    tags: [],
    hasOdv: false,
    checkTypes: [],
    remediationTypes: [],
    ...overrides,
  }
}

function manualRowFor(ruleId: string, overrides: Partial<RuleRow> = {}): RuleRow {
  return rowFor(ruleId, { assessment: { status: 'manual', manual_reason: null }, ...overrides })
}

function linkTo(rule: string): MappedRule {
  return { rule, relation: 'supports', direction: 'incoming', mapping: 'm', note: null, release: 'r1', selfRelease: 'r1' }
}

function keyFor(rows: RuleRow[], byRule: Map<string, MappedRule[]> = new Map()) {
  const rowsById = new Map(rows.map((row) => [row.ref.id, row]))
  return statusKeyGroups(rows, byRule, rowsById).map((group) => [group.heading, group.entries.map((entry) => entry.text)])
}

describe('statusKeyGroups', () => {
  it('groups platforms under the status of the rules that carry them', () => {
    const rows = [rowFor('mscp.a'), manualRowFor('cis.b', { targetKeys: ['Windows'] })]
    expect(keyFor(rows)).toEqual([
      ['Automated check', [targetIconFor('macOS').label]],
      ['Manual check', [targetIconFor('Windows').label]],
    ])
  })

  it('lists a manual rule with no target as No platform, last in its group', () => {
    const rows = [manualRowFor('cis.b', { targetKeys: ['Windows'] }), manualRowFor('ism.c', { targetKeys: [] })]
    expect(keyFor(rows)).toEqual([['Manual check', [targetIconFor('Windows').label, 'No platform']]])
  })

  it('sorts platforms by display label', () => {
    const rows = [rowFor('a.1', { targetKeys: ['Windows'] }), rowFor('a.2', { targetKeys: ['Linux'] }), rowFor('a.3')]
    const [[, labels]] = keyFor(rows)
    expect(labels).toEqual([...(labels as string[])].sort((left, right) => left.localeCompare(right, 'en')))
  })

  it('adds a Linked rules group for the link kinds some row has', () => {
    const rows = [rowFor('mscp.a'), manualRowFor('ism.b', { targetKeys: [] })]
    const byRule = new Map([['ism.b', [linkTo('mscp.a')]]])
    expect(keyFor(rows, byRule)).toContainEqual(['Linked rules', ['Linked to automated rules']])
  })

  it('returns no groups for no rows', () => {
    expect(statusKeyGroups([], new Map(), new Map())).toEqual([])
  })
})
