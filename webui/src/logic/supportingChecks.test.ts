import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildRuleRows } from '../data/ruleRows'
import type { Manifest, RuleIndex } from '../types/library'
import type { RuleRow } from '../types/rule-row'
import { supportChain } from './indirectMappings'
import { buildMappingIndex, linksWithinLibrary, parseMappingIndex, type MappedRule } from './mappingIndex'
import {
  DEFAULT_SUPPORTING_CHECK_CHOICES,
  chainAccessibleText,
  chainText,
  defaultSupportingCheckChoice,
  groupChoiceChanges,
  storedSupportingCheckChoice,
  includedSupportingRuleIds,
  isSupportingCheckIncluded,
  pruneSupportingCheckChoices,
  supportingCheckOffers,
  wouldIncludeSupportingRuleIds,
  type SupportingCheckChoices,
  type SupportingCheckOffer,
  type SupportingCheckOffers,
} from './supportingChecks'

type ByRule = Map<string, MappedRule[]>

function entry(rule: string, direction: MappedRule['direction']): MappedRule {
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

// `from` supports `to`.
function supports(byRule: ByRule, from: string, to: string) {
  byRule.set(from, [...(byRule.get(from) ?? []), entry(to, 'outgoing')])
  byRule.set(to, [...(byRule.get(to) ?? []), entry(from, 'incoming')])
}

function related(byRule: ByRule, first: string, second: string) {
  byRule.set(first, [...(byRule.get(first) ?? []), entry(second, 'related')])
  byRule.set(second, [...(byRule.get(second) ?? []), entry(first, 'related')])
}

function graph(build: (byRule: ByRule) => void): ByRule {
  const byRule: ByRule = new Map()
  build(byRule)
  return byRule
}

function row(ruleId: string, status: 'automated' | 'manual'): RuleRow {
  return {
    ref: { id: ruleId, path: `${ruleId}.json` },
    title: ruleId,
    targetKeys: [],
    section: 's',
    sectionPath: ['s'],
    sourceName: ruleId.slice(0, ruleId.indexOf('.')),
    releaseTag: 'r1',
    assessment: status === 'automated' ? { status, manual_reason: null } : { status, manual_reason: 'no_check' },
    architecture: null,
    applicability: [],
    scopeKeys: [],
    benchmarks: [],
    tags: [],
    hasOdv: false,
  }
}

function rowsOf(statusByRuleId: Record<string, 'automated' | 'manual'>): Map<string, RuleRow> {
  return new Map(Object.entries(statusByRuleId).map(([ruleId, status]) => [ruleId, row(ruleId, status)]))
}

function offerSummary(offer: SupportingCheckOffer) {
  return { ruleId: offer.ruleId, depth: offer.depth, controls: offer.supports.map((support) => support.controlId) }
}

describe('supportingCheckOffers', () => {
  it('offers an automated rule that directly supports a selected manual control', () => {
    const byRule = graph((map) => supports(map, 'mscp.check', 'ism.control'))
    const rows = rowsOf({ 'mscp.check': 'automated', 'ism.control': 'manual' })
    const offers = supportingCheckOffers(rows, byRule, new Set(['ism.control']))
    expect(offers.direct.map(offerSummary)).toEqual([{ ruleId: 'mscp.check', depth: 1, controls: ['ism.control'] }])
    expect(offers.throughOtherRules).toEqual([])
    expect(offers.controlsWithSupportIds).toEqual(['ism.control'])
    const [support] = offers.direct[0].supports
    expect(support.path.map((hop) => [hop.fromRuleId, hop.toRuleId, hop.step])).toEqual([['mscp.check', 'ism.control', 'supports']])
    expect(support.path[0].link.rule).toBe('ism.control')
  })

  it('offers a supporter two hops away through a manual rule, with its path from supporter to control', () => {
    const byRule = graph((map) => {
      supports(map, 'mscp.check', 'ism.middle')
      supports(map, 'ism.middle', 'ism.control')
    })
    const rows = rowsOf({ 'mscp.check': 'automated', 'ism.middle': 'manual', 'ism.control': 'manual' })
    const offers = supportingCheckOffers(rows, byRule, new Set(['ism.control']))
    expect(offers.direct).toEqual([])
    expect(offers.throughOtherRules.map(offerSummary)).toEqual([{ ruleId: 'mscp.check', depth: 2, controls: ['ism.control'] }])
    const [support] = offers.throughOtherRules[0].supports
    expect(support.path.map((hop) => [hop.fromRuleId, hop.toRuleId, hop.step])).toEqual([
      ['mscp.check', 'ism.middle', 'supports'],
      ['ism.middle', 'ism.control', 'supports'],
    ])
  })

  it('does not offer a peer that supports the same control as a selected manual rule', () => {
    const byRule = graph((map) => {
      supports(map, 'mscp.selected', 'ism.control')
      supports(map, 'mscp.peer', 'ism.control')
    })
    const rows = rowsOf({ 'mscp.selected': 'manual', 'mscp.peer': 'automated', 'ism.control': 'manual' })
    const offers = supportingCheckOffers(rows, byRule, new Set(['mscp.selected']))
    expect(offers.direct).toEqual([])
    expect(offers.throughOtherRules).toEqual([])
  })

  it('ignores related links', () => {
    const byRule = graph((map) => {
      related(map, 'mscp.cousin', 'ism.control')
      supports(map, 'mscp.cousin2', 'ism.middle')
      related(map, 'ism.middle', 'ism.control')
    })
    const rows = rowsOf({ 'mscp.cousin': 'automated', 'mscp.cousin2': 'automated', 'ism.middle': 'manual', 'ism.control': 'manual' })
    const offers = supportingCheckOffers(rows, byRule, new Set(['ism.control']))
    expect(offers.direct).toEqual([])
    expect(offers.throughOtherRules).toEqual([])
    expect(offers.controlsWithSupportIds).toEqual([])
  })

  it('walks through a manual supporter without offering it', () => {
    const byRule = graph((map) => {
      supports(map, 'ism.manual-supporter', 'ism.control')
      supports(map, 'mscp.check', 'ism.manual-supporter')
    })
    const rows = rowsOf({ 'ism.manual-supporter': 'manual', 'mscp.check': 'automated', 'ism.control': 'manual' })
    const offers = supportingCheckOffers(rows, byRule, new Set(['ism.control']))
    expect([...offers.direct, ...offers.throughOtherRules].map((offer) => offer.ruleId)).toEqual(['mscp.check'])
  })

  it('lists an already selected supporter separately and does not offer it', () => {
    const byRule = graph((map) => supports(map, 'mscp.check', 'ism.control'))
    const rows = rowsOf({ 'mscp.check': 'automated', 'ism.control': 'manual' })
    const offers = supportingCheckOffers(rows, byRule, new Set(['ism.control', 'mscp.check']))
    expect(offers.direct).toEqual([])
    expect(offers.alreadySelectedSupporterIds).toEqual(['mscp.check'])
    expect(offers.controlsWithSupportIds).toEqual(['ism.control'])
  })

  it('pulls nothing for a selected automated rule', () => {
    const byRule = graph((map) => {
      supports(map, 'mscp.other', 'mscp.selected')
    })
    const rows = rowsOf({ 'mscp.other': 'automated', 'mscp.selected': 'automated' })
    const offers = supportingCheckOffers(rows, byRule, new Set(['mscp.selected']))
    expect(offers).toEqual({ direct: [], throughOtherRules: [], alreadySelectedSupporterIds: [], controlsWithSupportIds: [] })
  })

  it('lists a rule that supports two controls once, at its smallest depth, with both paths', () => {
    const byRule = graph((map) => {
      supports(map, 'mscp.check', 'ism.b')
      supports(map, 'mscp.check', 'ism.middle')
      supports(map, 'ism.middle', 'ism.a')
    })
    const rows = rowsOf({ 'mscp.check': 'automated', 'ism.middle': 'manual', 'ism.a': 'manual', 'ism.b': 'manual' })
    const offers = supportingCheckOffers(rows, byRule, new Set(['ism.a', 'ism.b']))
    expect(offers.throughOtherRules).toEqual([])
    expect(offers.direct.map(offerSummary)).toEqual([{ ruleId: 'mscp.check', depth: 1, controls: ['ism.a', 'ism.b'] }])
    const [pathToA, pathToB] = offers.direct[0].supports.map((support) => support.path.length)
    expect([pathToA, pathToB]).toEqual([2, 1])
    expect(offers.controlsWithSupportIds).toEqual(['ism.a', 'ism.b'])
  })

  it('sorts direct offers by upstream id and through offers by depth then upstream id', () => {
    const byRule = graph((map) => {
      supports(map, 'mscp.zeta', 'ism.control')
      supports(map, 'mscp.alpha', 'ism.control')
      supports(map, 'mscp.deep-b', 'ism.middle')
      supports(map, 'mscp.deep-a', 'ism.middle')
      supports(map, 'ism.middle', 'ism.control')
      supports(map, 'mscp.deeper', 'ism.low')
      supports(map, 'ism.low', 'ism.middle')
    })
    const rows = rowsOf({
      'mscp.zeta': 'automated',
      'mscp.alpha': 'automated',
      'mscp.deep-b': 'automated',
      'mscp.deep-a': 'automated',
      'mscp.deeper': 'automated',
      'ism.middle': 'manual',
      'ism.low': 'manual',
      'ism.control': 'manual',
    })
    const offers = supportingCheckOffers(rows, byRule, new Set(['ism.control']))
    expect(offers.direct.map((offer) => offer.ruleId)).toEqual(['mscp.alpha', 'mscp.zeta'])
    expect(offers.throughOtherRules.map((offer) => [offer.ruleId, offer.depth])).toEqual([
      ['mscp.deep-a', 2],
      ['mscp.deep-b', 2],
      ['mscp.deeper', 3],
    ])
  })

  it('does not offer a supporter that has no row in the library', () => {
    const byRule = graph((map) => supports(map, 'mscp.unknown', 'ism.control'))
    const offers = supportingCheckOffers(rowsOf({ 'ism.control': 'manual' }), byRule, new Set(['ism.control']))
    expect(offers.direct).toEqual([])
  })
})

describe('supporting check choices', () => {
  const directOffer: SupportingCheckOffer = { ruleId: 'mscp.direct', depth: 1, supports: [] }
  const throughOffer: SupportingCheckOffer = { ruleId: 'mscp.through', depth: 2, supports: [] }
  const offers: SupportingCheckOffers = {
    direct: [directOffer],
    throughOtherRules: [throughOffer],
    alreadySelectedSupporterIds: [],
    controlsWithSupportIds: [],
  }
  const toggledOn: SupportingCheckChoices = { includeSupporting: true, overrides: {} }

  it('starts with the toggle off and no overrides', () => {
    expect(DEFAULT_SUPPORTING_CHECK_CHOICES).toEqual({ includeSupporting: false, overrides: {} })
  })

  it('includes direct offers and leaves through offers out by default once the toggle is on', () => {
    expect(isSupportingCheckIncluded(directOffer, toggledOn)).toBe(true)
    expect(isSupportingCheckIncluded(throughOffer, toggledOn)).toBe(false)
    expect(includedSupportingRuleIds(offers, toggledOn)).toEqual(['mscp.direct'])
  })

  it('lets an override win in both directions', () => {
    const choices: SupportingCheckChoices = {
      includeSupporting: true,
      overrides: { 'mscp.direct': 'exclude', 'mscp.through': 'include' },
    }
    expect(isSupportingCheckIncluded(directOffer, choices)).toBe(false)
    expect(isSupportingCheckIncluded(throughOffer, choices)).toBe(true)
    expect(includedSupportingRuleIds(offers, choices)).toEqual(['mscp.through'])
  })

  it('includes nothing while the toggle is off, whatever the overrides say', () => {
    const choices: SupportingCheckChoices = { includeSupporting: false, overrides: { 'mscp.through': 'include' } }
    expect(isSupportingCheckIncluded(throughOffer, choices)).toBe(false)
    expect(includedSupportingRuleIds(offers, choices)).toEqual([])
  })

  it('reports what turning the option on would include, honouring the overrides', () => {
    const off: SupportingCheckChoices = { includeSupporting: false, overrides: { 'mscp.direct': 'exclude' } }
    expect(includedSupportingRuleIds(offers, off)).toEqual([])
    expect(wouldIncludeSupportingRuleIds(offers, off)).toEqual([])
    expect(wouldIncludeSupportingRuleIds(offers, DEFAULT_SUPPORTING_CHECK_CHOICES)).toEqual(['mscp.direct'])
  })

  it('drops overrides for rules that are no longer offered', () => {
    const choices: SupportingCheckChoices = {
      includeSupporting: true,
      overrides: { 'mscp.direct': 'exclude', 'mscp.gone': 'include' },
    }
    expect(pruneSupportingCheckChoices(choices, offers)).toEqual({ includeSupporting: true, overrides: { 'mscp.direct': 'exclude' } })
  })

  it('returns the same object when pruning changes nothing', () => {
    const choices: SupportingCheckChoices = { includeSupporting: true, overrides: { 'mscp.direct': 'exclude' } }
    expect(pruneSupportingCheckChoices(choices, offers)).toBe(choices)
    expect(pruneSupportingCheckChoices(DEFAULT_SUPPORTING_CHECK_CHOICES, offers)).toBe(DEFAULT_SUPPORTING_CHECK_CHOICES)
  })
})

describe('group choices', () => {
  const directOffer: SupportingCheckOffer = { ruleId: 'mscp.direct', depth: 1, supports: [] }
  const throughOffer: SupportingCheckOffer = { ruleId: 'mscp.through', depth: 2, supports: [] }

  it('defaults to include for a direct check and exclude for one through other rules', () => {
    expect(defaultSupportingCheckChoice(directOffer)).toBe('include')
    expect(defaultSupportingCheckChoice(throughOffer)).toBe('exclude')
  })

  it('stores only a choice that differs from the default', () => {
    expect(storedSupportingCheckChoice(directOffer, 'include')).toBe('default')
    expect(storedSupportingCheckChoice(directOffer, 'exclude')).toBe('exclude')
    expect(storedSupportingCheckChoice(throughOffer, 'include')).toBe('include')
    expect(storedSupportingCheckChoice(throughOffer, 'exclude')).toBe('default')
  })

  it('splits a group choice into overrides and rules that return to their default', () => {
    expect(groupChoiceChanges([directOffer, throughOffer], 'include')).toEqual({
      overrideRuleIds: ['mscp.through'],
      defaultRuleIds: ['mscp.direct'],
    })
    expect(groupChoiceChanges([directOffer, throughOffer], 'exclude')).toEqual({
      overrideRuleIds: ['mscp.direct'],
      defaultRuleIds: ['mscp.through'],
    })
  })
})

describe('chain text', () => {
  const byRule = graph((map) => {
    supports(map, 'mscp.check', 'ism.middle')
    supports(map, 'ism.middle', 'ism.control')
  })
  const rows = rowsOf({ 'mscp.check': 'automated', 'ism.middle': 'manual', 'ism.control': 'manual' })
  const [offer] = supportingCheckOffers(rows, byRule, new Set(['ism.control'])).throughOtherRules
  const [{ path }] = offer.supports
  const label = (ruleId: string) => ruleId.slice(ruleId.indexOf('.') + 1)

  it('writes the visible chain with arrows', () => {
    expect(chainText(path, label)).toBe('check -> supports middle -> supports control')
  })

  it('writes the spoken chain in words', () => {
    expect(chainAccessibleText(path, label)).toBe('check supports middle, which supports control')
  })

  it('handles a single hop', () => {
    expect(chainText(path.slice(0, 1), label)).toBe('check -> supports middle')
    expect(chainAccessibleText(path.slice(0, 1), label)).toBe('check supports middle')
  })
})

describe('supportChain facts this feature depends on', () => {
  it('ignores related hops in both directions of travel', () => {
    const byRule = graph((map) => {
      supports(map, 'supporter', 'control')
      related(map, 'control', 'cousin')
      related(map, 'supporter', 'supporter-cousin')
      supports(map, 'under-cousin', 'cousin')
    })
    expect(supportChain('control', byRule, 'supported-by').map((chainEntry) => chainEntry.ruleId)).toEqual(['supporter'])
  })
})

describe('real committed data', () => {
  const baselinesDirectory = new URL('../../../baselines/', import.meta.url)
  const readBaselinesJson = <T>(relativePath: string): T => JSON.parse(readFileSync(new URL(relativePath, baselinesDirectory), 'utf8')) as T

  const manifest = readBaselinesJson<Manifest>('_manifest.json')
  const rows = manifest.sources.flatMap((source) => buildRuleRows(source, readBaselinesJson<RuleIndex>(source.index_path)))
  const rowsById = new Map(rows.map((libraryRow) => [libraryRow.ref.id, libraryRow]))

  const mappingsDirectory = new URL('_mappings/rules/', baselinesDirectory)
  const mappingFiles = readdirSync(mappingsDirectory)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort()
    .map((fileName) => ({ fileName, value: JSON.parse(readFileSync(new URL(fileName, mappingsDirectory), 'utf8')) as unknown }))
  const parsedIndex = parseMappingIndex(buildMappingIndex(mappingFiles, () => undefined))
  if (typeof parsedIndex === 'string') throw new Error(parsedIndex)
  const byRule = linksWithinLibrary(parsedIndex.byRule, new Set(rowsById.keys()))

  it('offers 144 direct automated checks for every ISM control at PROTECTED', () => {
    const selectedRuleIds = new Set(
      rows.filter((libraryRow) => libraryRow.sourceName === 'asd_ism' && libraryRow.benchmarks.includes('ism_protected')).map((libraryRow) => libraryRow.ref.id),
    )
    expect(selectedRuleIds.size).toBe(1028)

    const startedAt = performance.now()
    const offers = supportingCheckOffers(rowsById, byRule, selectedRuleIds)
    const elapsedMilliseconds = performance.now() - startedAt

    expect(offers.direct).toHaveLength(144)
    expect(offers.throughOtherRules).toHaveLength(0)
    expect(offers.controlsWithSupportIds).toHaveLength(56)
    expect(offers.direct.filter((offer) => rowsById.get(offer.ruleId)?.hasOdv)).toHaveLength(16)
    expect(elapsedMilliseconds).toBeLessThan(200)
  })
})
