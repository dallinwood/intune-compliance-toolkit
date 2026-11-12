import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  INDIRECT_MAPPING_DEPTH_LIMIT,
  cachedIndirectMappedRules,
  canExtendPath,
  effectiveRelationOf,
  indirectMappedRules,
  stepOf,
  supportChain,
  type MappingStep,
} from './indirectMappings'
import { buildMappingIndex, parseMappingIndex, type MappedRule } from './mappingIndex'

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

function pathIds(rule: { path: { toRuleId: string }[] }): string[] {
  return rule.path.map((hop) => hop.toRuleId)
}

describe('stepOf', () => {
  it('reads a link from the rule it leaves', () => {
    expect(stepOf(entry('x', 'outgoing'))).toBe('supports')
    expect(stepOf(entry('x', 'incoming'))).toBe('supported-by')
    expect(stepOf(entry('x', 'related'))).toBe('related')
  })
})

describe('canExtendPath', () => {
  const allowed: [MappingStep[], MappingStep][] = [
    [[], 'supports'],
    [[], 'supported-by'],
    [[], 'related'],
    [['supports'], 'supports'],
    [['supported-by'], 'supported-by'],
    [['supports'], 'related'],
    [['supported-by'], 'related'],
    [['related'], 'supports'],
    [['related'], 'supported-by'],
    [['supports', 'related'], 'supports'],
    [['related', 'supported-by'], 'supported-by'],
  ]
  const refused: [MappingStep[], MappingStep][] = [
    [['supports'], 'supported-by'],
    [['supported-by'], 'supports'],
    [['related'], 'related'],
    [['supports', 'related'], 'related'],
    [['supports', 'related'], 'supported-by'],
    [['related', 'supports'], 'supported-by'],
  ]
  it.each(allowed)('allows %j then %s', (steps, next) => {
    expect(canExtendPath(steps, next)).toBe(true)
  })
  it.each(refused)('refuses %j then %s', (steps, next) => {
    expect(canExtendPath(steps, next)).toBe(false)
  })
})

describe('effectiveRelationOf', () => {
  it('is the weakest hop: related wins, otherwise the single supports step', () => {
    expect(effectiveRelationOf(['supports'])).toBe('supports')
    expect(effectiveRelationOf(['supports', 'supports'])).toBe('supports')
    expect(effectiveRelationOf(['supported-by', 'supported-by'])).toBe('supported-by')
    expect(effectiveRelationOf(['supports', 'related'])).toBe('related')
    expect(effectiveRelationOf(['related', 'supported-by'])).toBe('related')
    expect(effectiveRelationOf(['related'])).toBe('related')
  })
})

describe('indirectMappedRules', () => {
  it('lists an action related to a supported control, as related (the gatekeeper shape)', () => {
    const byRule = graph((map) => {
      supports(map, 'mscp.gate', 'ism.1584')
      supports(map, 'mscp.gate', 'ism.0864')
      supports(map, 'mscp.gate', 'nist.cm-5')
      supports(map, 'mscp.peer', 'ism.1584')
      related(map, 'e4eit.pro-12.2', 'ism.1584')
    })
    const result = indirectMappedRules('mscp.gate', byRule)
    expect(result.truncated).toBe(false)
    expect(result.rules).toHaveLength(1)
    const [action] = result.rules
    expect(action.ruleId).toBe('e4eit.pro-12.2')
    expect(pathIds(action)).toEqual(['ism.1584', 'e4eit.pro-12.2'])
    expect(action.path.map((hop) => hop.step)).toEqual(['supports', 'related'])
    expect(action.path[0].fromRuleId).toBe('mscp.gate')
    expect(action.path[1].fromRuleId).toBe('ism.1584')
    expect(action.effectiveRelation).toBe('related')
    expect(action.alsoThroughRuleIds).toEqual([])
  })

  it('lists each rule once with the other same-depth paths in alsoThroughRuleIds (the IT.DET-01.1 shape)', () => {
    const byRule = graph((map) => {
      for (const control of ['ism.1984', 'ism.1985', 'ism.1815']) related(map, 'e4eit.det', control)
      for (const control of ['ism.1985', 'ism.1815']) {
        for (let ruleNumber = 1; ruleNumber <= 12; ruleNumber += 1) supports(map, `mscp.rule${ruleNumber}`, control)
      }
    })
    const result = indirectMappedRules('e4eit.det', byRule)
    expect(result.rules).toHaveLength(12)
    for (const rule of result.rules) {
      expect(rule.effectiveRelation).toBe('related')
      expect(rule.path.map((hop) => hop.step)).toEqual(['related', 'supported-by'])
      expect(pathIds(rule)[0]).toBe('ism.1815')
      expect(rule.alsoThroughRuleIds).toEqual(['ism.1985'])
    }
    expect(new Set(result.rules.map((rule) => rule.ruleId)).size).toBe(12)
  })

  it('never lists the start rule or a directly mapped rule', () => {
    const byRule = graph((map) => {
      supports(map, 'a', 'b')
      supports(map, 'a', 'c')
      supports(map, 'b', 'c')
    })
    const result = indirectMappedRules('a', byRule)
    expect(result.rules).toEqual([])
  })

  it('leaves out peers: up then down, and related then related', () => {
    const byRule = graph((map) => {
      supports(map, 'start', 'control')
      supports(map, 'peer', 'control')
      related(map, 'start', 'shared')
      related(map, 'other', 'shared')
    })
    expect(indirectMappedRules('start', byRule).rules).toEqual([])
  })

  it('follows supports hops in one direction only, in both directions', () => {
    const byRule = graph((map) => {
      supports(map, 'start', 'one')
      supports(map, 'one', 'two')
      supports(map, 'below-one', 'start')
      supports(map, 'below-two', 'below-one')
    })
    const result = indirectMappedRules('start', byRule)
    const summary = result.rules.map((rule) => [rule.ruleId, rule.effectiveRelation, rule.path.length])
    expect(summary).toEqual([
      ['below-two', 'supported-by', 2],
      ['two', 'supports', 2],
    ])
  })

  it('allows one related hop before or after supports hops', () => {
    const byRule = graph((map) => {
      related(map, 'start', 'friend')
      supports(map, 'beneficiary', 'friend')
      supports(map, 'start', 'control')
      related(map, 'control', 'action')
    })
    const summary = indirectMappedRules('start', byRule).rules.map((rule) => [rule.ruleId, rule.effectiveRelation])
    expect(summary).toEqual([
      ['action', 'related'],
      ['beneficiary', 'related'],
    ])
  })

  it('terminates on a supports cycle and lists the opposite side once', () => {
    const byRule = graph((map) => {
      for (const [from, to] of [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a']]) supports(map, from, to)
    })
    const result = indirectMappedRules('a', byRule)
    expect(result.rules.map((rule) => [rule.ruleId, pathIds(rule), rule.alsoThroughRuleIds])).toEqual([['c', ['b', 'c'], ['d']]])
    expect(result.truncated).toBe(false)
  })

  it('stops at the depth limit and says so', () => {
    const byRule = graph((map) => {
      for (const [from, to] of [['s', 'a'], ['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e']]) supports(map, from, to)
    })
    const result = indirectMappedRules('s', byRule)
    expect(INDIRECT_MAPPING_DEPTH_LIMIT).toBe(4)
    expect(result.rules.map((rule) => rule.ruleId)).toEqual(['b', 'c', 'd'])
    expect(result.truncated).toBe(true)
  })

  it('is not truncated when the chain ends exactly at the limit', () => {
    const byRule = graph((map) => {
      for (const [from, to] of [['s', 'a'], ['a', 'b'], ['b', 'c'], ['c', 'd']]) supports(map, from, to)
    })
    const result = indirectMappedRules('s', byRule)
    expect(result.rules.map((rule) => rule.ruleId)).toEqual(['b', 'c', 'd'])
    expect(result.truncated).toBe(false)
  })

  it('honours a smaller depth limit', () => {
    const byRule = graph((map) => {
      for (const [from, to] of [['s', 'a'], ['a', 'b'], ['b', 'c']]) supports(map, from, to)
    })
    const result = indirectMappedRules('s', byRule, 2)
    expect(result.rules.map((rule) => rule.ruleId)).toEqual(['b'])
    expect(result.truncated).toBe(true)
  })

  it('prefers the shortest path', () => {
    const byRule = graph((map) => {
      supports(map, 's', 'a')
      supports(map, 'a', 'x')
      supports(map, 's', 'b')
      supports(map, 'b', 'c')
      supports(map, 'c', 'x')
    })
    const [rule] = indirectMappedRules('s', byRule).rules.filter((candidate) => candidate.ruleId === 'x')
    expect(pathIds(rule)).toEqual(['a', 'x'])
    expect(rule.alsoThroughRuleIds).toEqual([])
  })

  it('prefers a supports path over a related path of the same length', () => {
    const byRule = graph((map) => {
      related(map, 's', 'aaa')
      supports(map, 'x', 'aaa')
      supports(map, 's', 'zzz')
      supports(map, 'zzz', 'x')
    })
    const [rule] = indirectMappedRules('s', byRule).rules
    expect(rule.ruleId).toBe('x')
    expect(pathIds(rule)).toEqual(['zzz', 'x'])
    expect(rule.effectiveRelation).toBe('supports')
    expect(rule.alsoThroughRuleIds).toEqual(['aaa'])
  })

  it('breaks a full tie by the path rule ids, and lists the rest sorted', () => {
    const byRule = graph((map) => {
      for (const through of ['c', 'a', 'b']) {
        supports(map, 's', through)
        supports(map, through, 'x')
      }
    })
    const [rule] = indirectMappedRules('s', byRule).rules
    expect(pathIds(rule)).toEqual(['a', 'x'])
    expect(rule.alsoThroughRuleIds).toEqual(['b', 'c'])
  })

  it('orders results by depth, then path', () => {
    const byRule = graph((map) => {
      supports(map, 's', 'b')
      supports(map, 's', 'a')
      supports(map, 'b', 'deep')
      supports(map, 'deep', 'deeper')
      supports(map, 'a', 'z-two')
      supports(map, 'b', 'a-two')
    })
    const order = indirectMappedRules('s', byRule).rules.map((rule) => rule.ruleId)
    expect(order).toEqual(['z-two', 'a-two', 'deep', 'deeper'])
  })

  it('returns nothing for a rule with no links', () => {
    expect(indirectMappedRules('lonely', new Map())).toEqual({ rules: [], truncated: false })
  })
})

describe('cachedIndirectMappedRules', () => {
  it('returns the same object for the same index and rule', () => {
    const byRule = graph((map) => {
      supports(map, 'a', 'b')
      supports(map, 'b', 'c')
    })
    const first = cachedIndirectMappedRules('a', byRule)
    expect(cachedIndirectMappedRules('a', byRule)).toBe(first)
    expect(first.rules.map((rule) => rule.ruleId)).toEqual(['c'])
  })

  it('does not share results between indexes', () => {
    const byRule = graph((map) => supports(map, 'a', 'b'))
    const other = graph((map) => supports(map, 'a', 'b'))
    expect(cachedIndirectMappedRules('a', byRule)).not.toBe(cachedIndirectMappedRules('a', other))
  })
})

describe('supportChain', () => {
  const byRule = graph((map) => {
    supports(map, 'mid', 'top')
    supports(map, 'low-one', 'mid')
    supports(map, 'low-two', 'mid')
    supports(map, 'lowest', 'low-one')
    supports(map, 'lowest', 'low-two')
    related(map, 'mid', 'cousin')
    supports(map, 'top', 'low-two')
  })

  it('lists the rules that support a rule, directly and through other rules, nearest first', () => {
    const chain = supportChain('top', byRule, 'supported-by')
    expect(chain.map((entry) => [entry.ruleId, entry.path.length])).toEqual([
      ['mid', 1],
      ['low-one', 2],
      ['low-two', 2],
      ['lowest', 3],
    ])
    const lowest = chain[3]
    expect(lowest.path.map((hop) => [hop.fromRuleId, hop.toRuleId, hop.step])).toEqual([
      ['top', 'mid', 'supported-by'],
      ['mid', 'low-one', 'supported-by'],
      ['low-one', 'lowest', 'supported-by'],
    ])
  })

  it('lists the rules a rule supports, ignoring related links', () => {
    const chain = supportChain('lowest', byRule, 'supports')
    expect(chain.map((entry) => entry.ruleId)).toEqual(['low-one', 'low-two', 'mid', 'top'])
    expect(chain.every((entry) => entry.path.every((hop) => hop.step === 'supports'))).toBe(true)
  })

  it('terminates on a cycle and respects the depth limit', () => {
    const cyclic = graph((map) => {
      supports(map, 'a', 'b')
      supports(map, 'b', 'c')
      supports(map, 'c', 'a')
    })
    expect(supportChain('a', cyclic, 'supports').map((entry) => entry.ruleId)).toEqual(['b', 'c'])
    expect(supportChain('a', cyclic, 'supports', 1).map((entry) => entry.ruleId)).toEqual(['b'])
  })
})

describe('real committed mappings', () => {
  const mappingsDirectory = new URL('../../../baselines/_mappings/rules/', import.meta.url)
  const files = readdirSync(mappingsDirectory)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort()
    .map((fileName) => ({ fileName, value: JSON.parse(readFileSync(new URL(fileName, mappingsDirectory), 'utf8')) as unknown }))
  const parsed = parseMappingIndex(buildMappingIndex(files, () => undefined))
  if (typeof parsed === 'string') throw new Error(parsed)
  const { byRule } = parsed

  function directCount(ruleId: string): number {
    return new Set((byRule.get(ruleId) ?? []).map((link) => link.rule)).size
  }

  it('reaches one indirect rule from the gatekeeper rule', () => {
    const ruleId = 'mscp.system_settings_gatekeeper_override_disallow'
    const result = indirectMappedRules(ruleId, byRule)
    expect(directCount(ruleId)).toBe(4)
    expect(result.rules.map((rule) => [rule.ruleId, rule.effectiveRelation, pathIds(rule)])).toEqual([
      ['asd_e4eit.it.pro-12.2', 'related', ['asd_ism.ism-1584', 'asd_e4eit.it.pro-12.2']],
    ])
    expect(result.truncated).toBe(false)
  })

  it('reaches 12 mSCP rules, each once, from E4EIT IT.DET-01.1', () => {
    const ruleId = 'asd_e4eit.it.det-01.1'
    const result = indirectMappedRules(ruleId, byRule)
    expect(directCount(ruleId)).toBe(3)
    expect(result.rules).toHaveLength(12)
    for (const rule of result.rules) {
      expect(rule.ruleId.startsWith('mscp.')).toBe(true)
      expect(rule.effectiveRelation).toBe('related')
      expect(rule.path).toHaveLength(2)
      expect(rule.alsoThroughRuleIds).toHaveLength(1)
    }
    expect(result.truncated).toBe(false)
  })

  it('keeps indirect reach small across the whole graph', () => {
    let rulesWithIndirect = 0
    let mostIndirect = 0
    let deepestPath = 0
    let anyTruncated = false
    for (const ruleId of byRule.keys()) {
      const result = indirectMappedRules(ruleId, byRule)
      if (result.rules.length > 0) rulesWithIndirect += 1
      mostIndirect = Math.max(mostIndirect, result.rules.length)
      for (const rule of result.rules) deepestPath = Math.max(deepestPath, rule.path.length)
      anyTruncated ||= result.truncated
    }
    expect(byRule.size).toBe(764)
    expect(rulesWithIndirect).toBe(118)
    expect(mostIndirect).toBe(60)
    expect(deepestPath).toBe(2)
    expect(anyTruncated).toBe(false)
  })
})
