import { describe, expect, it } from 'vitest'
import type { MappedRule } from './mappingIndex'
import {
  ALL_CONTROLS_SCOPE,
  coverageFrameworks,
  frameworkCoverage,
  scopeOptions,
  selectedRulesSupportingNothing,
  type CoverageInput,
} from './selectionCoverage'
import type { RuleRow } from '../types/rule-row'

interface RowOptions {
  sourceName: string
  upstreamId: string
  section?: string
  benchmarks?: string[]
  assessmentStatus?: 'automated' | 'manual'
}

function row({ sourceName, upstreamId, section = 'Section A', benchmarks = [], assessmentStatus = 'automated' }: RowOptions): RuleRow {
  const id = `${sourceName}.${upstreamId}`
  return {
    ref: { id, path: `${sourceName}/${upstreamId}.json` },
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
    benchmarks,
    tags: [],
    hasOdv: false,
  } as unknown as RuleRow
}

function entry(rule: string, relation: 'supports' | 'related', direction: MappedRule['direction'], overrides: Partial<MappedRule> = {}): MappedRule {
  return { rule, relation, direction, mapping: 'test-mapping', note: null, release: 'r1', selfRelease: 'r1', ...overrides }
}

function supportPair(fromRule: string, toRule: string, overrides: Partial<MappedRule> = {}): Array<[string, MappedRule]> {
  return [
    [fromRule, entry(toRule, 'supports', 'outgoing', overrides)],
    [toRule, entry(fromRule, 'supports', 'incoming', overrides)],
  ]
}

function relatedPair(leftRule: string, rightRule: string): Array<[string, MappedRule]> {
  return [
    [leftRule, entry(rightRule, 'related', 'related')],
    [rightRule, entry(leftRule, 'related', 'related')],
  ]
}

function indexOf(pairs: Array<[string, MappedRule]>): Map<string, MappedRule[]> {
  const index = new Map<string, MappedRule[]>()
  for (const [ruleId, mapped] of pairs) index.set(ruleId, [...(index.get(ruleId) ?? []), mapped])
  return index
}

function input(
  rows: RuleRow[],
  pairs: Array<[string, MappedRule]>,
  selectedRuleIds: string[],
  automatedOnly = false,
): CoverageInput {
  return { rows, mappingsByRule: indexOf(pairs), selectedRuleIds: new Set(selectedRuleIds), automatedOnly }
}

const ruleOne = row({ sourceName: 'mscp', upstreamId: 'rule_one' })
const ruleTwo = row({ sourceName: 'mscp', upstreamId: 'rule_two' })
const controlA = row({ sourceName: 'asd_ism', upstreamId: 'ism-1', benchmarks: ['ism_protected'] })
const controlB = row({ sourceName: 'asd_ism', upstreamId: 'ism-2', benchmarks: ['ism_secret'] })

describe('coverageFrameworks', () => {
  it('lists a source on the to side of supports as a coverage framework and not the from side', () => {
    const frameworks = coverageFrameworks([ruleOne, controlA], indexOf(supportPair(ruleOne.ref.id, controlA.ref.id)))

    expect(frameworks).toEqual({ counted: ['asd_ism'], relatedOnly: [] })
  })

  it('names a source with only related links as related-only', () => {
    const actionRow = row({ sourceName: 'asd_e4eit', upstreamId: 'it.pro-13.1' })
    const frameworks = coverageFrameworks(
      [ruleOne, controlA, actionRow],
      indexOf([...supportPair(ruleOne.ref.id, controlA.ref.id), ...relatedPair(actionRow.ref.id, controlA.ref.id)]),
    )

    expect(frameworks).toEqual({ counted: ['asd_ism'], relatedOnly: ['asd_e4eit'] })
  })

  it('does not name a supporting source as related-only even when it also has related links', () => {
    const frameworks = coverageFrameworks(
      [ruleOne, controlA, ruleTwo],
      indexOf([...supportPair(ruleOne.ref.id, controlA.ref.id), ...relatedPair(ruleTwo.ref.id, controlA.ref.id)]),
    )

    expect(frameworks.relatedOnly).toEqual([])
  })

  it('returns nothing for an empty mapping index', () => {
    expect(coverageFrameworks([ruleOne], new Map())).toEqual({ counted: [], relatedOnly: [] })
  })
})

describe('scopeOptions', () => {
  it('starts with all and orders benchmarks by the comparator', () => {
    const options = scopeOptions([controlA, controlB, ruleOne], 'asd_ism', (left, right) => right.localeCompare(left))

    expect(options).toEqual([ALL_CONTROLS_SCOPE, 'ism_secret', 'ism_protected'])
  })
})

describe('frameworkCoverage', () => {
  const rows = [ruleOne, ruleTwo, controlA, controlB]

  it('counts a control once even when two selected rules support it', () => {
    const pairs = [...supportPair(ruleOne.ref.id, controlA.ref.id), ...supportPair(ruleTwo.ref.id, controlA.ref.id)]

    const coverage = frameworkCoverage(input(rows, pairs, [ruleOne.ref.id, ruleTwo.ref.id]), 'asd_ism', ALL_CONTROLS_SCOPE)

    expect(coverage.covered).toBe(1)
    expect(coverage.total).toBe(2)
    expect(coverage.sections[0].controls[0].supportedBy.map((link) => link.rule.ref.id)).toEqual([ruleOne.ref.id, ruleTwo.ref.id])
  })

  it('does not count a related link: the control is related-only and covered stays 0', () => {
    const actionRow = row({ sourceName: 'asd_e4eit', upstreamId: 'it.pro-13.1' })

    const coverage = frameworkCoverage(
      input([...rows, actionRow], relatedPair(actionRow.ref.id, controlA.ref.id), [actionRow.ref.id]),
      'asd_ism',
      ALL_CONTROLS_SCOPE,
    )

    expect(coverage.covered).toBe(0)
    expect(coverage.relatedOnly).toBe(1)
    const [related] = coverage.sections[0].controls
    expect(related.status).toBe('related-only')
    expect(related.relatedTo.map((link) => link.rule.ref.id)).toEqual([actionRow.ref.id])
  })

  it('ignores links from unselected rules', () => {
    const coverage = frameworkCoverage(
      input(rows, supportPair(ruleOne.ref.id, controlA.ref.id), [ruleTwo.ref.id]),
      'asd_ism',
      ALL_CONTROLS_SCOPE,
    )

    expect(coverage.covered).toBe(0)
  })

  it('ignores support from a rule of the same framework', () => {
    const coverage = frameworkCoverage(
      input(rows, supportPair(controlB.ref.id, controlA.ref.id), [controlB.ref.id]),
      'asd_ism',
      ALL_CONTROLS_SCOPE,
    )

    expect(coverage.covered).toBe(0)
  })

  it('automatedOnly drops support from a manual rule', () => {
    const manualRule = row({ sourceName: 'mscp', upstreamId: 'manual_rule', assessmentStatus: 'manual' })
    const pairs = supportPair(manualRule.ref.id, controlA.ref.id)
    const withManual = [...rows, manualRule]

    expect(frameworkCoverage(input(withManual, pairs, [manualRule.ref.id]), 'asd_ism', ALL_CONTROLS_SCOPE).covered).toBe(1)
    expect(frameworkCoverage(input(withManual, pairs, [manualRule.ref.id], true), 'asd_ism', ALL_CONTROLS_SCOPE).covered).toBe(0)
  })

  it('a selected control of the framework is selectedDirectly and not covered', () => {
    const coverage = frameworkCoverage(input(rows, [], [controlA.ref.id]), 'asd_ism', ALL_CONTROLS_SCOPE)

    expect(coverage.selectedDirectly).toBe(1)
    expect(coverage.covered).toBe(0)
    expect(coverage.sections[0].controls.find((control) => control.control === controlA)?.selectedDirectly).toBe(true)
  })

  it('scope narrows the denominator to rows carrying that benchmark', () => {
    const pairs = supportPair(ruleOne.ref.id, controlA.ref.id)

    const coverage = frameworkCoverage(input(rows, pairs, [ruleOne.ref.id]), 'asd_ism', 'ism_protected')

    expect(coverage.total).toBe(1)
    expect(coverage.covered).toBe(1)
    expect(coverage.scope).toBe('ism_protected')
  })

  it('groups sections in first-seen order and drops empty sections', () => {
    const lateSection = row({ sourceName: 'asd_ism', upstreamId: 'ism-3', section: 'Zeta', benchmarks: ['ism_protected'] })
    const earlySection = row({ sourceName: 'asd_ism', upstreamId: 'ism-0', section: 'Alpha', benchmarks: ['ism_secret'] })

    const all = frameworkCoverage(input([lateSection, earlySection, controlA], [], []), 'asd_ism', ALL_CONTROLS_SCOPE)
    const protectedOnly = frameworkCoverage(input([earlySection, lateSection], [], []), 'asd_ism', 'ism_protected')

    expect(all.sections.map((section) => section.section)).toEqual(['Zeta', 'Alpha', 'Section A'])
    expect(protectedOnly.sections.map((section) => section.section)).toEqual(['Zeta'])
  })

  it('orders controls covered, related-only, then uncovered, each by upstream id', () => {
    const actionRow = row({ sourceName: 'asd_e4eit', upstreamId: 'it.pro-13.1' })
    const controlC = row({ sourceName: 'asd_ism', upstreamId: 'ism-0' })
    const pairs = [...supportPair(ruleOne.ref.id, controlB.ref.id), ...relatedPair(actionRow.ref.id, controlA.ref.id)]

    const coverage = frameworkCoverage(
      input([ruleOne, actionRow, controlA, controlB, controlC], pairs, [ruleOne.ref.id, actionRow.ref.id]),
      'asd_ism',
      ALL_CONTROLS_SCOPE,
    )

    expect(coverage.sections[0].controls.map((control) => `${control.status} ${control.control.ref.id}`)).toEqual([
      'covered asd_ism.ism-2',
      'related-only asd_ism.ism-1',
      'uncovered asd_ism.ism-0',
    ])
    expect(coverage.sections[0]).toMatchObject({ covered: 1, relatedOnly: 1, total: 3 })
  })

  it('marks a link checked against an older release when changedKinds is non-empty or null, not when []', () => {
    function olderReleaseFlag(overrides: Partial<MappedRule>): boolean {
      const coverage = frameworkCoverage(
        input(rows, supportPair(ruleOne.ref.id, controlA.ref.id, overrides), [ruleOne.ref.id]),
        'asd_ism',
        ALL_CONTROLS_SCOPE,
      )
      return coverage.sections[0].controls[0].supportedBy[0].checkedAgainstOlderRelease
    }

    expect(olderReleaseFlag({ changedKinds: ['wording'] })).toBe(true)
    expect(olderReleaseFlag({ selfChangedKinds: null })).toBe(true)
    expect(olderReleaseFlag({ changedKinds: [], selfChangedKinds: [] })).toBe(false)
    expect(olderReleaseFlag({})).toBe(false)
  })

  it('an empty selection gives covered 0 and the full total', () => {
    const coverage = frameworkCoverage(input(rows, supportPair(ruleOne.ref.id, controlA.ref.id), []), 'asd_ism', ALL_CONTROLS_SCOPE)

    expect(coverage).toMatchObject({ covered: 0, relatedOnly: 0, selectedDirectly: 0, total: 2 })
  })

  it('keeps dotted upstream ids intact when linking', () => {
    const dottedControl = row({ sourceName: 'nist_800_53', upstreamId: 'ac-2.1' })
    const coverage = frameworkCoverage(
      input([ruleOne, dottedControl], supportPair(ruleOne.ref.id, dottedControl.ref.id), [ruleOne.ref.id]),
      'nist_800_53',
      ALL_CONTROLS_SCOPE,
    )

    expect(coverage.covered).toBe(1)
  })
})

describe('selectedRulesSupportingNothing', () => {
  it('lists only selected rules with no link into a framework', () => {
    const lonelyRule = row({ sourceName: 'mscp', upstreamId: 'a_lonely_rule' })
    const actionRow = row({ sourceName: 'asd_e4eit', upstreamId: 'it.pro-13.1' })
    const unselectedLonelyRule = row({ sourceName: 'mscp', upstreamId: 'unselected_rule' })
    const allRows = [ruleOne, ruleTwo, lonelyRule, unselectedLonelyRule, controlA, actionRow]
    const pairs = [...supportPair(ruleOne.ref.id, controlA.ref.id), ...relatedPair(ruleTwo.ref.id, controlA.ref.id)]
    const selected = [ruleOne, ruleTwo, lonelyRule, actionRow, controlA].map((selectedRow) => selectedRow.ref.id)

    const lonely = selectedRulesSupportingNothing(input(allRows, pairs, selected), ['asd_ism'])

    expect(lonely.map((lonelyRow) => lonelyRow.ref.id)).toEqual(['mscp.a_lonely_rule', 'asd_e4eit.it.pro-13.1'])
  })
})
