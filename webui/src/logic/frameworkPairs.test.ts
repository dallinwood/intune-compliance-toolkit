import { describe, expect, it } from 'vitest'
import type { MappedRule } from './mappingIndex'
import {
  capCount,
  combinedCoverage,
  coveringSourcesOf,
  frameworkPairs,
  pairCoverage,
  type FrameworkPair,
  type SelectionSettings,
  type SupportsPair,
} from './frameworkPairs'
import { ALL_CONTROLS_SCOPE } from './selectionCoverage'
import type { RuleRow } from '../types/rule-row'

interface RowOptions {
  sourceName: string
  upstreamId: string
  benchmarks?: string[]
  assessmentStatus?: 'automated' | 'manual'
}

function row({ sourceName, upstreamId, benchmarks = [], assessmentStatus = 'automated' }: RowOptions): RuleRow {
  return {
    ref: { id: `${sourceName}.${upstreamId}`, path: `${sourceName}/${upstreamId}.json` },
    title: `Title of ${upstreamId}`,
    targetKeys: [],
    section: 'Section A',
    sectionPath: ['Section A'],
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

function entry(rule: string, relation: 'supports' | 'related', direction: MappedRule['direction']): MappedRule {
  return { rule, relation, direction, mapping: 'test-mapping', note: null, release: 'r1', selfRelease: 'r1' }
}

function supportPair(fromRule: string, toRule: string): Array<[string, MappedRule]> {
  return [
    [fromRule, entry(toRule, 'supports', 'outgoing')],
    [toRule, entry(fromRule, 'supports', 'incoming')],
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

function settings(selectedRuleIds: string[], automatedOnly = false, includeSupporting = false): SelectionSettings {
  return { selectedRuleIds: new Set(selectedRuleIds), automatedOnly, choices: { includeSupporting, overrides: {} } }
}

function supportsPair(coveringSource: string, coveredSource: string): SupportsPair {
  return { kind: 'supports', coveringSource, coveredSource }
}

describe('frameworkPairs', () => {
  it('finds a direct supports pair', () => {
    const rows = [row({ sourceName: 'a', upstreamId: 'r1' }), row({ sourceName: 'b', upstreamId: 'c1' })]

    expect(frameworkPairs(rows, indexOf(supportPair('a.r1', 'b.c1')))).toEqual([supportsPair('a', 'b')])
  })

  it('finds a transitive supports pair', () => {
    const rows = [row({ sourceName: 'a', upstreamId: 'r1' }), row({ sourceName: 'c', upstreamId: 'x1' }), row({ sourceName: 'b', upstreamId: 'c1' })]
    const byRule = indexOf([...supportPair('a.r1', 'c.x1'), ...supportPair('c.x1', 'b.c1')])

    expect(frameworkPairs(rows, byRule)).toEqual(expect.arrayContaining([supportsPair('a', 'c'), supportsPair('c', 'b'), supportsPair('a', 'b')]))
  })

  it('records a related link once', () => {
    const rows = [row({ sourceName: 'e', upstreamId: 'r1' }), row({ sourceName: 'b', upstreamId: 'c1' })]

    expect(frameworkPairs(rows, indexOf(relatedPair('e.r1', 'b.c1')))).toEqual([{ kind: 'related', sources: ['b', 'e'] }])
  })

  it('drops a related pair when the same frameworks already form a supports pair', () => {
    const rows = [row({ sourceName: 'a', upstreamId: 'r1' }), row({ sourceName: 'b', upstreamId: 'c1' }), row({ sourceName: 'b', upstreamId: 'c2' })]
    const byRule = indexOf([...supportPair('a.r1', 'b.c1'), ...relatedPair('a.r1', 'b.c2')])

    expect(frameworkPairs(rows, byRule)).toEqual([supportsPair('a', 'b')])
  })

  it('returns nothing for empty mappings', () => {
    expect(frameworkPairs([row({ sourceName: 'a', upstreamId: 'r1' })], new Map())).toEqual([])
  })
})

describe('coveringSourcesOf', () => {
  it('includes supports and related partners', () => {
    const pairs: FrameworkPair[] = [supportsPair('a', 'b'), { kind: 'related', sources: ['b', 'e'] }]

    expect(coveringSourcesOf(pairs, 'b')).toEqual(['a', 'e'])
  })
})

const aRuleOne = row({ sourceName: 'a', upstreamId: 'r1' })
const aRuleTwo = row({ sourceName: 'a', upstreamId: 'r2' })
const dRule = row({ sourceName: 'd', upstreamId: 'r9' })
const bControlOne = row({ sourceName: 'b', upstreamId: 'c1', benchmarks: ['bench_one'] })
const bControlTwo = row({ sourceName: 'b', upstreamId: 'c2', benchmarks: ['bench_two'] })
const bControlThree = row({ sourceName: 'b', upstreamId: 'c3', benchmarks: ['bench_two'] })

describe('pairCoverage', () => {
  const rows = [aRuleOne, aRuleTwo, dRule, bControlOne, bControlTwo, bControlThree]
  const byRule = indexOf([...supportPair('a.r1', 'b.c1'), ...supportPair('a.r2', 'b.c2'), ...supportPair('d.r9', 'b.c3')])

  it('cap counts every rule of the covering framework', () => {
    const { cap, selection } = pairCoverage(rows, byRule, supportsPair('a', 'b'), settings([]), ALL_CONTROLS_SCOPE)

    expect(capCount(cap)).toBe(2)
    expect(selection.covered).toBe(0)
    expect(cap.total).toBe(3)
  })

  it('selection counts only the covering framework rules', () => {
    const { selection } = pairCoverage(rows, byRule, supportsPair('a', 'b'), settings(['a.r1', 'd.r9']), ALL_CONTROLS_SCOPE)

    expect(selection.covered).toBe(1)
  })

  it('narrows total, cap and selection to the scope', () => {
    const { cap, selection } = pairCoverage(rows, byRule, supportsPair('a', 'b'), settings(['a.r1', 'a.r2']), 'bench_one')

    expect(cap.total).toBe(1)
    expect(capCount(cap)).toBe(1)
    expect(selection.total).toBe(1)
    expect(selection.covered).toBe(1)
  })
})

describe('combinedCoverage', () => {
  it('selection uses the whole selection', () => {
    const eRule = row({ sourceName: 'e', upstreamId: 'r1' })
    const rows = [aRuleOne, eRule, bControlOne, bControlTwo]
    const byRule = indexOf([...supportPair('a.r1', 'b.c1'), ...supportPair('e.r1', 'b.c2')])

    const { cap, selection } = combinedCoverage(rows, byRule, 'b', ['a', 'e'], settings(['a.r1', 'e.r1']), ALL_CONTROLS_SCOPE)

    expect(selection.covered).toBe(2)
    expect(capCount(cap)).toBe(2)
  })
})

describe('selection never exceeds cap', () => {
  const manualControl = row({ sourceName: 'b', upstreamId: 'c4', assessmentStatus: 'manual' })
  const manualAdjacent = row({ sourceName: 'a', upstreamId: 'm1', assessmentStatus: 'manual' })
  const automatedSupporter = row({ sourceName: 'd', upstreamId: 's1' })
  const rows = [aRuleOne, aRuleTwo, dRule, manualAdjacent, automatedSupporter, bControlOne, bControlTwo, manualControl]
  const byRule = indexOf([
    ...supportPair('a.r1', 'b.c1'),
    ...supportPair('a.r2', 'b.c2'),
    ...supportPair('d.r9', 'b.c4'),
    ...supportPair('d.s1', 'a.m1'),
    ...supportPair('a.m1', 'b.c4'),
  ])
  const selectableRuleIds = ['a.r1', 'a.r2', 'a.m1', 'd.r9']

  it('holds for every subset, mode and supporting choice', () => {
    for (let subsetMask = 0; subsetMask < 2 ** selectableRuleIds.length; subsetMask += 1) {
      const selected = selectableRuleIds.filter((_, position) => (subsetMask >> position) & 1)
      for (const automatedOnly of [true, false]) {
        for (const includeSupporting of [true, false]) {
          const selectionSettings = settings(selected, automatedOnly, includeSupporting)
          const single = pairCoverage(rows, byRule, supportsPair('a', 'b'), selectionSettings, ALL_CONTROLS_SCOPE)
          const combined = combinedCoverage(rows, byRule, 'b', ['a', 'd'], selectionSettings, ALL_CONTROLS_SCOPE)
          expect(capCount(single.selection)).toBeLessThanOrEqual(capCount(single.cap))
          expect(capCount(combined.selection)).toBeLessThanOrEqual(capCount(combined.cap))
        }
      }
    }
  })
})
