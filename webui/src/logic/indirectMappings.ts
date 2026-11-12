// Indirect (chained) mapped rules, from the index built by mappingIndex.ts.
// Design: docs/plans/2026-11-12-mapped-rules-rework-design.md, section 5.
//
// A chain is followed only when every `supports` hop points the same way and
// at most one hop is `related`. Anything else makes peers of the two rules
// ("both support the same control"), and following peers reaches most of the
// graph. The supports chain itself is reusable on its own: see supportChain.

import { compareText } from './catalogIndex'
import type { MappingGroupRelation } from './mappedRuleView'
import type { MappedRule } from './mappingIndex'

export const INDIRECT_MAPPING_DEPTH_LIMIT = 4

// The step as seen from the rule a hop leaves.
export type MappingStep = MappingGroupRelation
export type EffectiveRelation = MappingGroupRelation

export interface MappingHop {
  fromRuleId: string
  toRuleId: string
  step: MappingStep
  // The index entry as seen from fromRuleId.
  link: MappedRule
}

export interface IndirectMappedRule {
  ruleId: string
  // From the open rule to ruleId; length >= 2.
  path: MappingHop[]
  effectiveRelation: EffectiveRelation
  // Rules just before ruleId on other allowed paths of the same length, sorted.
  alsoThroughRuleIds: string[]
}

export interface IndirectMappings {
  rules: IndirectMappedRule[]
  // True when the depth limit stopped a chain that could have gone on.
  truncated: boolean
}

export function stepOf(link: MappedRule): MappingStep {
  if (link.direction === 'related') return 'related'
  return link.direction === 'outgoing' ? 'supports' : 'supported-by'
}

export function canExtendPath(steps: readonly MappingStep[], next: MappingStep): boolean {
  if (next === 'related') return !steps.includes('related')
  const oppositeStep: MappingStep = next === 'supports' ? 'supported-by' : 'supports'
  return !steps.includes(oppositeStep)
}

export function effectiveRelationOf(steps: readonly MappingStep[]): EffectiveRelation {
  if (steps.includes('related')) return 'related'
  return steps[0]
}

function stepsOf(path: readonly MappingHop[]): MappingStep[] {
  return path.map((hop) => hop.step)
}

function pathKey(path: readonly MappingHop[]): string {
  return path.map((hop) => hop.toRuleId).join('\n')
}

function comparePaths(left: readonly MappingHop[], right: readonly MappingHop[]): number {
  return compareText(pathKey(left), pathKey(right))
}

// What the rest of a search needs to know about where a path has been.
function searchStateKey(path: readonly MappingHop[]): string {
  const steps = stepsOf(path)
  const supportsStep = steps.find((step) => step !== 'related') ?? 'none'
  return `${path[path.length - 1].toRuleId}|${supportsStep}|${steps.includes('related')}`
}

function hopsFrom(ruleId: string, byRule: ReadonlyMap<string, MappedRule[]>): MappingHop[] {
  return (byRule.get(ruleId) ?? []).map((link) => ({ fromRuleId: ruleId, toRuleId: link.rule, step: stepOf(link), link }))
}

function allowedExtensions(
  path: readonly MappingHop[],
  byRule: ReadonlyMap<string, MappedRule[]>,
  excludedRuleIds: ReadonlySet<string>,
): MappingHop[][] {
  const lastRuleId = path[path.length - 1].toRuleId
  const ruleIdsOnPath = new Set([path[0].fromRuleId, ...path.map((hop) => hop.toRuleId)])
  const steps = stepsOf(path)
  return hopsFrom(lastRuleId, byRule)
    .filter((hop) => !ruleIdsOnPath.has(hop.toRuleId) && !excludedRuleIds.has(hop.toRuleId) && canExtendPath(steps, hop.step))
    .map((hop) => [...path, hop])
}

function betterPath(left: readonly MappingHop[], right: readonly MappingHop[]): number {
  const strength = (path: readonly MappingHop[]) => (effectiveRelationOf(stepsOf(path)) === 'related' ? 1 : 0)
  return strength(left) - strength(right) || comparePaths(left, right)
}

export function indirectMappedRules(
  startRuleId: string,
  byRule: ReadonlyMap<string, MappedRule[]>,
  depthLimit: number = INDIRECT_MAPPING_DEPTH_LIMIT,
): IndirectMappings {
  const directHops = hopsFrom(startRuleId, byRule)
  const excludedRuleIds = new Set([startRuleId, ...directHops.map((hop) => hop.toRuleId)])
  const visitedStates = new Set<string>()
  let frontier: MappingHop[][] = []
  for (const hop of [...directHops].sort((left, right) => compareText(left.toRuleId, right.toRuleId))) {
    const path = [hop]
    const stateKey = searchStateKey(path)
    if (visitedStates.has(stateKey)) continue
    visitedStates.add(stateKey)
    frontier.push(path)
  }

  const listedRuleIds = new Set<string>()
  const rules: IndirectMappedRule[] = []
  for (let depth = 2; depth <= depthLimit && frontier.length > 0; depth += 1) {
    const candidates = frontier.flatMap((path) => allowedExtensions(path, byRule, excludedRuleIds))

    const candidatesByRule = new Map<string, MappingHop[][]>()
    for (const candidate of candidates) {
      const ruleId = candidate[candidate.length - 1].toRuleId
      if (listedRuleIds.has(ruleId)) continue
      candidatesByRule.set(ruleId, [...(candidatesByRule.get(ruleId) ?? []), candidate])
    }
    const listedThisDepth: IndirectMappedRule[] = []
    for (const [ruleId, paths] of candidatesByRule) {
      const [best, ...others] = [...paths].sort(betterPath)
      const alsoThroughRuleIds = [...new Set(others.map((path) => path[path.length - 2].toRuleId))]
        .filter((throughRuleId) => throughRuleId !== best[best.length - 2].toRuleId)
        .sort(compareText)
      listedRuleIds.add(ruleId)
      listedThisDepth.push({
        ruleId,
        path: best,
        effectiveRelation: effectiveRelationOf(stepsOf(best)),
        alsoThroughRuleIds,
      })
    }
    rules.push(...listedThisDepth.sort((left, right) => comparePaths(left.path, right.path)))

    const nextFrontier: MappingHop[][] = []
    for (const candidate of [...candidates].sort(comparePaths)) {
      const stateKey = searchStateKey(candidate)
      if (visitedStates.has(stateKey)) continue
      visitedStates.add(stateKey)
      nextFrontier.push(candidate)
    }
    frontier = nextFrontier
  }

  const truncated = frontier.some((path) => allowedExtensions(path, byRule, excludedRuleIds).length > 0)
  return { rules, truncated }
}

const indirectMappingsCache = new WeakMap<ReadonlyMap<string, MappedRule[]>, Map<string, IndirectMappings>>()

// Cached per index and start rule, so re-renders and re-opening a rule do not re-walk.
export function cachedIndirectMappedRules(startRuleId: string, byRule: ReadonlyMap<string, MappedRule[]>): IndirectMappings {
  let cacheForIndex = indirectMappingsCache.get(byRule)
  if (cacheForIndex === undefined) {
    cacheForIndex = new Map()
    indirectMappingsCache.set(byRule, cacheForIndex)
  }
  const cached = cacheForIndex.get(startRuleId)
  if (cached !== undefined) return cached
  const computed = indirectMappedRules(startRuleId, byRule)
  cacheForIndex.set(startRuleId, computed)
  return computed
}

export interface SupportChainEntry {
  ruleId: string
  // From the start rule to ruleId; length >= 1, every step is the requested direction.
  path: MappingHop[]
}

// The rules reachable by following only `supports` links in one direction, nearest first:
// 'supported-by' lists the rules that support the start rule, directly (path length 1) and through
// other rules; 'supports' lists the rules the start rule supports. A rule appears once, by its
// shortest path (ties by rule ids). Related links are ignored. Use this to pull what supporting
// rules offer (for example automated checks) for a rule that has none of its own.
export function supportChain(
  startRuleId: string,
  byRule: ReadonlyMap<string, MappedRule[]>,
  direction: 'supports' | 'supported-by',
  depthLimit: number = INDIRECT_MAPPING_DEPTH_LIMIT,
): SupportChainEntry[] {
  const visitedRuleIds = new Set([startRuleId])
  const chain: SupportChainEntry[] = []
  let frontier: MappingHop[][] = [[]]
  for (let depth = 1; depth <= depthLimit && frontier.length > 0; depth += 1) {
    const candidates: MappingHop[][] = []
    for (const path of frontier) {
      const fromRuleId = path.length === 0 ? startRuleId : path[path.length - 1].toRuleId
      for (const hop of hopsFrom(fromRuleId, byRule)) {
        if (hop.step === direction) candidates.push([...path, hop])
      }
    }
    const nextFrontier: MappingHop[][] = []
    for (const candidate of candidates.sort(comparePaths)) {
      const ruleId = candidate[candidate.length - 1].toRuleId
      if (visitedRuleIds.has(ruleId)) continue
      visitedRuleIds.add(ruleId)
      chain.push({ ruleId, path: candidate })
      nextFrontier.push(candidate)
    }
    frontier = nextFrontier
  }
  return chain
}
