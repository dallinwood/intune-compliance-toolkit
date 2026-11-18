import { describe, expect, it } from 'vitest'
import type { MappedRule } from './mappingIndex'
import { pairCoverage, type SelectionSettings } from './frameworkPairs'
import { ALL_CONTROLS_SCOPE } from './selectionCoverage'
import { controlStatusText, coveringRulesInSection, sectionsWithinReach, selectedFirst } from './sectionDrillDown'
import type { RuleRow } from '../types/rule-row'

interface RowOptions {
  sourceName: string
  upstreamId: string
  section?: string
  assessmentStatus?: 'automated' | 'manual'
}

function row({ sourceName, upstreamId, section = 'Section A', assessmentStatus = 'automated' }: RowOptions): RuleRow {
  return {
    ref: { id: `${sourceName}.${upstreamId}`, path: `${sourceName}/${upstreamId}.json` },
    title: `Title of ${upstreamId}`,
    targetKeys: [],
    section,
    sectionPath: [section],
    sourceName,
    releaseTag: 'r1',
    assessment: { status: assessmentStatus, manual_reason: assessmentStatus === 'manual' ? 'no_technical_control' : null },
    architecture: null,
    applicability: [],
    scopeKeys: [],
    benchmarks: [],
    tags: [],
    hasOdv: false,
  } as unknown as RuleRow
}

function entry(rule: string, direction: MappedRule['direction']): MappedRule {
  return { rule, relation: 'supports', direction, mapping: 'test-mapping', note: null, release: 'r1', selfRelease: 'r1' }
}

function supportPair(fromRule: string, toRule: string): Array<[string, MappedRule]> {
  return [
    [fromRule, entry(toRule, 'outgoing')],
    [toRule, entry(fromRule, 'incoming')],
  ]
}

function indexOf(pairs: Array<[string, MappedRule]>): Map<string, MappedRule[]> {
  const index = new Map<string, MappedRule[]>()
  for (const [ruleId, mapped] of pairs) index.set(ruleId, [...(index.get(ruleId) ?? []), mapped])
  return index
}

function settings(selectedRuleIds: string[], automatedOnly = false): SelectionSettings {
  return { selectedRuleIds: new Set(selectedRuleIds), automatedOnly, choices: { includeSupporting: false, overrides: {} } }
}

const PAIR = { kind: 'supports', coveringSource: 'a', coveredSource: 'b' } as const

const automatedRule = row({ sourceName: 'a', upstreamId: 'r1' })
const secondAutomatedRule = row({ sourceName: 'a', upstreamId: 'r2' })
const manualRule = row({ sourceName: 'a', upstreamId: 'm1', assessmentStatus: 'manual' })
const firstSectionControl = row({ sourceName: 'b', upstreamId: 'c1', section: 'First' })
const secondSectionControl = row({ sourceName: 'b', upstreamId: 'c2', section: 'Second' })
const secondSectionOtherControl = row({ sourceName: 'b', upstreamId: 'c3', section: 'Second' })
const manualOnlySectionControl = row({ sourceName: 'b', upstreamId: 'c4', section: 'Manual only' })
const unmappedSectionControl = row({ sourceName: 'b', upstreamId: 'c5', section: 'Unmapped' })

const rows = [
  automatedRule,
  secondAutomatedRule,
  manualRule,
  firstSectionControl,
  secondSectionControl,
  secondSectionOtherControl,
  manualOnlySectionControl,
  unmappedSectionControl,
]
const byRule = indexOf([
  ...supportPair('a.r1', 'b.c1'),
  ...supportPair('a.r1', 'b.c2'),
  ...supportPair('a.r2', 'b.c3'),
  ...supportPair('a.m1', 'b.c4'),
])

function sectionNames(automatedOnly: boolean): string[] {
  const { cap, selection } = pairCoverage(rows, byRule, PAIR, settings([], automatedOnly), ALL_CONTROLS_SCOPE)
  return sectionsWithinReach(selection, cap).map((entry) => entry.section.section)
}

describe('sectionsWithinReach', () => {
  it('hides sections the covering framework cannot reach', () => {
    expect(sectionNames(false)).not.toContain('Unmapped')
  })

  it('orders sections by their cap, largest first, ties in section order', () => {
    expect(sectionNames(false)).toEqual(['Second', 'First', 'Manual only'])
  })

  it('drops a section reached only through manual rules when Automated checks only is on', () => {
    expect(sectionNames(true)).toEqual(['Second', 'First'])
  })

  it('pairs each displayed section with its own cap', () => {
    const { cap, selection } = pairCoverage(rows, byRule, PAIR, settings(['a.r2']), ALL_CONTROLS_SCOPE)

    const withinReach = sectionsWithinReach(selection, cap)

    expect(withinReach.map((entry) => [entry.section.section, entry.section.covered, entry.capCount])).toEqual([
      ['Second', 1, 2],
      ['First', 0, 1],
      ['Manual only', 0, 1],
    ])
  })
})

describe('coveringRulesInSection', () => {
  const coveringRows = [automatedRule, secondAutomatedRule, manualRule]

  it('lists the covering rules that reach the section, with the controls each supports there', () => {
    const rulesInSection = coveringRulesInSection(coveringRows, byRule, new Set(['b.c2', 'b.c3']), false)

    expect(rulesInSection.map((entry) => [entry.rule.ref.id, entry.supportedControlIds])).toEqual([
      ['a.r1', ['b.c2']],
      ['a.r2', ['b.c3']],
    ])
  })

  it('follows supports chains through other rules', () => {
    const chainedByRule = indexOf([...supportPair('a.r1', 'b.c1'), ...supportPair('b.c1', 'b.c2')])

    const rulesInSection = coveringRulesInSection(coveringRows, chainedByRule, new Set(['b.c2']), false)

    expect(rulesInSection.map((entry) => [entry.rule.ref.id, entry.supportedControlIds])).toEqual([['a.r1', ['b.c2']]])
  })

  it('leaves manual rules out when Automated checks only is on', () => {
    expect(coveringRulesInSection(coveringRows, byRule, new Set(['b.c4']), false).map((entry) => entry.rule.ref.id)).toEqual(['a.m1'])
    expect(coveringRulesInSection(coveringRows, byRule, new Set(['b.c4']), true)).toEqual([])
  })
})

describe('selectedFirst', () => {
  it('splits items into selected and unselected, keeping their order', () => {
    expect(selectedFirst(['one', 'two', 'three', 'four'], (item) => item === 'two' || item === 'four')).toEqual({
      selected: ['two', 'four'],
      unselected: ['one', 'three'],
    })
  })
})

describe('controlStatusText', () => {
  it('names every status', () => {
    expect(controlStatusText('covered')).toBe('Covered directly')
    expect(controlStatusText('covered-through-supporting')).toBe('Covered through supporting checks')
    expect(controlStatusText('related-only')).toBe('Related only')
    expect(controlStatusText('uncovered')).toBe('Not covered')
  })
})
