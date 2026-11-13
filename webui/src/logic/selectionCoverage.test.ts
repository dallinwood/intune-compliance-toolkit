import { describe, expect, it } from 'vitest'
import type { MappedRule } from './mappingIndex'
import {
  ALL_CONTROLS_SCOPE,
  coverageFrameworks,
  frameworkCoverage,
  coverageBarLabel,
  coverageHeadline,
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
  supporting: { included?: string[]; offered?: string[] } = {},
): CoverageInput {
  return {
    rows,
    mappingsByRule: indexOf(pairs),
    selectedRuleIds: new Set(selectedRuleIds),
    automatedOnly,
    includedSupportingRuleIds: new Set(supporting.included ?? []),
    offeredSupportingRuleIds: new Set(supporting.offered ?? []),
  }
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

describe('coverage through supporting rules', () => {
  const supporter = row({ sourceName: 'mscp', upstreamId: 'supporter' })
  const otherSupporter = row({ sourceName: 'mscp', upstreamId: 'other_supporter' })
  const manualRule = row({ sourceName: 'mscp', upstreamId: 'manual_rule', assessmentStatus: 'manual' })
  const controlC = row({ sourceName: 'asd_ism', upstreamId: 'ism-3', benchmarks: ['ism_protected'], section: 'Section B' })
  const rows = [supporter, otherSupporter, manualRule, controlA, controlB, controlC]
  const scopeAll = (coverageInput: CoverageInput) => frameworkCoverage(coverageInput, 'asd_ism', ALL_CONTROLS_SCOPE)
  const controlOf = (coverage: ReturnType<typeof scopeAll>, control: RuleRow) =>
    coverage.sections.flatMap((section) => section.controls).find((entry) => entry.control.ref.id === control.ref.id)

  it('with empty sets gives the same numbers as before and no through status', () => {
    const pairs = supportPair(supporter.ref.id, controlA.ref.id)
    const coverage = scopeAll(input(rows, pairs, [supporter.ref.id]))
    expect(coverage.covered).toBe(1)
    expect(coverage.coveredThroughSupporting).toBe(0)
    expect(coverage.potentialThroughSupporting).toBe(0)
    const statuses = coverage.sections.flatMap((section) => section.controls).map((entry) => entry.status)
    expect(statuses).not.toContain('covered-through-supporting')
  })

  it('makes a control covered through supporting when an included supporting check supports it, and not direct', () => {
    const pairs = supportPair(supporter.ref.id, controlA.ref.id)
    const coverage = scopeAll(input(rows, pairs, [controlA.ref.id], false, { included: [supporter.ref.id] }))
    const control = controlOf(coverage, controlA)
    expect(control?.status).toBe('covered-through-supporting')
    expect(control?.supportedBy).toEqual([])
    expect(control?.throughChains).toHaveLength(1)
    expect(control?.throughChains[0].startsAtSupportingCheck).toBe(true)
    expect(control?.throughChains[0].path.map((hop) => [hop.fromRuleId, hop.toRuleId, hop.step])).toEqual([
      [supporter.ref.id, controlA.ref.id, 'supports'],
    ])
    expect(coverage.covered).toBe(0)
    expect(coverage.coveredThroughSupporting).toBe(1)
    expect(coverage.selectedDirectly).toBe(1)
  })

  it('counts a two-hop chain from a selected rule as through, and the first hop as direct', () => {
    const pairs = [...supportPair(supporter.ref.id, controlA.ref.id), ...supportPair(controlA.ref.id, controlC.ref.id)]
    const coverage = scopeAll(input(rows, pairs, [supporter.ref.id]))
    expect(controlOf(coverage, controlA)?.status).toBe('covered')
    const chained = controlOf(coverage, controlC)
    expect(chained?.status).toBe('covered-through-supporting')
    expect(chained?.throughChains[0].startsAtSupportingCheck).toBe(false)
    expect(chained?.throughChains[0].path).toHaveLength(2)
    expect(coverage.covered).toBe(1)
    expect(coverage.coveredThroughSupporting).toBe(1)
  })

  it('lets direct support win over a chain', () => {
    const pairs = [...supportPair(supporter.ref.id, controlA.ref.id), ...supportPair(otherSupporter.ref.id, controlA.ref.id)]
    const coverage = scopeAll(input(rows, pairs, [supporter.ref.id], false, { included: [otherSupporter.ref.id] }))
    const control = controlOf(coverage, controlA)
    expect(control?.status).toBe('covered')
    expect(control?.throughChains).toEqual([])
    expect(coverage.coveredThroughSupporting).toBe(0)
  })

  it('never counts a related link, even from a rule that is also an included supporting check', () => {
    const offered = [supporter.ref.id]
    const coverage = scopeAll(
      input(rows, relatedPair(supporter.ref.id, controlA.ref.id), [supporter.ref.id], false, { included: offered, offered }),
    )
    expect(controlOf(coverage, controlA)?.status).toBe('related-only')
    expect(coverage.coveredThroughSupporting).toBe(0)
    expect(coverage.potentialThroughSupporting).toBe(0)
  })

  it('applies the automated-only filter to chains from selected rules', () => {
    const pairs = [...supportPair(manualRule.ref.id, controlA.ref.id), ...supportPair(controlA.ref.id, controlC.ref.id)]
    const everything = scopeAll(input(rows, pairs, [manualRule.ref.id], false))
    const automatedOnly = scopeAll(input(rows, pairs, [manualRule.ref.id], true))
    expect(everything.coveredThroughSupporting).toBe(1)
    expect(automatedOnly.coveredThroughSupporting).toBe(0)
  })

  it('reports the potential separately from what is included', () => {
    const pairs = [...supportPair(supporter.ref.id, controlA.ref.id), ...supportPair(otherSupporter.ref.id, controlB.ref.id)]
    const offered = [supporter.ref.id, otherSupporter.ref.id]
    const selected = [controlA.ref.id, controlB.ref.id]
    const none = scopeAll(input(rows, pairs, selected, false, { offered }))
    expect(none.coveredThroughSupporting).toBe(0)
    expect(none.potentialThroughSupporting).toBe(2)
    const some = scopeAll(input(rows, pairs, selected, false, { included: [supporter.ref.id], offered }))
    expect(some.coveredThroughSupporting).toBe(1)
    expect(some.potentialThroughSupporting).toBe(2)
  })

  it('counts through-supporting controls per section and lists them after the directly supported ones', () => {
    const pairs = [...supportPair(supporter.ref.id, controlA.ref.id), ...supportPair(otherSupporter.ref.id, controlC.ref.id)]
    const coverage = scopeAll(input(rows, pairs, [supporter.ref.id], false, { included: [otherSupporter.ref.id] }))
    expect(coverage.sections.find((section) => section.section === 'Section B')?.coveredThroughSupporting).toBe(1)
    const sectionA = coverage.sections.find((section) => section.section === 'Section A')
    expect(sectionA?.covered).toBe(1)
    expect(sectionA?.controls.map((entry) => entry.status)).toEqual(['covered', 'uncovered'])
  })

  it('lists chains nearest first', () => {
    const pairs = [
      ...supportPair(supporter.ref.id, controlA.ref.id),
      ...supportPair(otherSupporter.ref.id, controlB.ref.id),
      ...supportPair(controlB.ref.id, controlA.ref.id),
    ]
    const included = [supporter.ref.id, otherSupporter.ref.id]
    const coverage = scopeAll(input(rows, pairs, [controlA.ref.id], false, { included }))
    const chains = controlOf(coverage, controlA)?.throughChains.map((chain) => chain.path.map((hop) => hop.fromRuleId))
    expect(chains).toEqual([[supporter.ref.id], [otherSupporter.ref.id, controlB.ref.id]])
  })
})

describe('coverageHeadline and coverageBarLabel', () => {
  const base = { sourceName: 'asd_ism', scope: 'all', relatedOnly: 4, selectedDirectly: 0, sections: [] }

  it('reads as it always did when nothing is through supporting rules', () => {
    const coverage = { ...base, covered: 61, coveredThroughSupporting: 0, potentialThroughSupporting: 0, total: 1143 }
    expect(coverageHeadline(coverage, null)).toBe('Supports 61 of 1143 controls')
    expect(coverageHeadline(coverage, 'ISM PROTECTED')).toBe('Supports 61 of 1143 controls at ISM PROTECTED')
    expect(coverageBarLabel(coverage)).toBe('61 of 1143 supported, 4 related only')
  })

  it('names directly and through supporting rules, with the scope', () => {
    const coverage = { ...base, covered: 61, coveredThroughSupporting: 14, potentialThroughSupporting: 20, total: 1143 }
    expect(coverageHeadline(coverage, 'ISM PROTECTED')).toBe('Supports 61 directly, +14 through supporting rules, of 1,143 at ISM PROTECTED')
    expect(coverageBarLabel(coverage)).toBe('61 supported directly, 14 through supporting rules, 4 related only, of 1,143')
  })
})
