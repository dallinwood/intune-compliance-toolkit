// Framework pairs and capped coverage (docs/plans/2026-11-18-unified-frameworks-design.md,
// "Coverage reports"): which frameworks support or relate to which, and for each supports
// pair how much of the covered framework could be reached (the cap) next to how much the
// user's selection reaches.

import type { RuleRow } from '../types/rule-row'
import { compareText } from './catalogIndex'
import { supportChain } from './indirectMappings'
import type { MappedRule } from './mappingIndex'
import { frameworkCoverage, type CoverageInput, type FrameworkCoverage } from './selectionCoverage'
import { supportingCheckOffers, includedSupportingRuleIds, wouldIncludeSupportingRuleIds, type SupportingCheckChoices } from './supportingChecks'

export interface SupportsPair {
  kind: 'supports'
  coveringSource: string
  coveredSource: string
}

export interface RelatedPair {
  kind: 'related'
  sources: [string, string]
}

export type FrameworkPair = SupportsPair | RelatedPair

export interface SelectionSettings {
  selectedRuleIds: ReadonlySet<string>
  automatedOnly: boolean
  choices: SupportingCheckChoices
}

export interface CappedCoverage {
  cap: FrameworkCoverage
  selection: FrameworkCoverage
}

function unorderedKey(leftSource: string, rightSource: string): string {
  return [leftSource, rightSource].sort(compareText).join('\n')
}

export function frameworkPairs(rows: readonly RuleRow[], byRule: ReadonlyMap<string, MappedRule[]>): FrameworkPair[] {
  const rowsById = new Map(rows.map((row) => [row.ref.id, row]))
  const supportsPairs = new Map<string, SupportsPair>()
  const relatedSourcePairs = new Map<string, [string, string]>()

  for (const row of rows) {
    for (const { ruleId: reachedRuleId } of supportChain(row.ref.id, byRule, 'supports')) {
      const reachedSource = rowsById.get(reachedRuleId)?.sourceName
      if (reachedSource === undefined || reachedSource === row.sourceName) continue
      supportsPairs.set(`${row.sourceName}\n${reachedSource}`, { kind: 'supports', coveringSource: row.sourceName, coveredSource: reachedSource })
    }
    for (const entry of byRule.get(row.ref.id) ?? []) {
      if (entry.relation !== 'related') continue
      const otherSource = rowsById.get(entry.rule)?.sourceName
      if (otherSource === undefined || otherSource === row.sourceName) continue
      const sortedSources = [row.sourceName, otherSource].sort(compareText) as [string, string]
      relatedSourcePairs.set(unorderedKey(row.sourceName, otherSource), sortedSources)
    }
  }

  const frameworksWithSupportsPair = new Set([...supportsPairs.values()].map((pair) => unorderedKey(pair.coveringSource, pair.coveredSource)))
  const relatedPairs = [...relatedSourcePairs]
    .filter(([key]) => !frameworksWithSupportsPair.has(key))
    .map(([, sources]): RelatedPair => ({ kind: 'related', sources }))
    .sort((left, right) => compareText(left.sources.join('\n'), right.sources.join('\n')))
  const sortedSupportsPairs = [...supportsPairs.values()].sort(
    (left, right) => compareText(left.coveringSource, right.coveringSource) || compareText(left.coveredSource, right.coveredSource),
  )
  return [...sortedSupportsPairs, ...relatedPairs]
}

export function coveringSourcesOf(pairs: readonly FrameworkPair[], coveredSource: string): string[] {
  const coveringSources = new Set<string>()
  for (const pair of pairs) {
    if (pair.kind === 'supports') {
      if (pair.coveredSource === coveredSource) coveringSources.add(pair.coveringSource)
    } else if (pair.sources.includes(coveredSource)) {
      coveringSources.add(pair.sources[0] === coveredSource ? pair.sources[1] : pair.sources[0])
    }
  }
  return [...coveringSources].sort(compareText)
}

export function supportsPairsCovering(pairs: readonly FrameworkPair[], coveringSource: string): SupportsPair[] {
  return pairs.filter((pair): pair is SupportsPair => pair.kind === 'supports' && pair.coveringSource === coveringSource)
}

export function capCount(coverage: FrameworkCoverage): number {
  return coverage.covered + coverage.coveredThroughSupporting
}

function selectionInput(
  rows: readonly RuleRow[],
  byRule: ReadonlyMap<string, MappedRule[]>,
  coveringSources: ReadonlySet<string>,
  settings: SelectionSettings,
): CoverageInput {
  const rowsById = new Map(rows.map((row) => [row.ref.id, row]))
  const restrictedRuleIds = new Set(
    [...settings.selectedRuleIds].filter((ruleId) => {
      const sourceName = rowsById.get(ruleId)?.sourceName
      return sourceName !== undefined && coveringSources.has(sourceName)
    }),
  )
  const offers = supportingCheckOffers(rowsById, byRule, restrictedRuleIds)
  return {
    rows,
    mappingsByRule: byRule,
    selectedRuleIds: restrictedRuleIds,
    automatedOnly: settings.automatedOnly,
    includedSupportingRuleIds: new Set(includedSupportingRuleIds(offers, settings.choices)),
    supportingRuleIdsIfAdded: new Set(wouldIncludeSupportingRuleIds(offers, settings.choices)),
  }
}

function capInput(rows: readonly RuleRow[], byRule: ReadonlyMap<string, MappedRule[]>, coveringSources: ReadonlySet<string>): CoverageInput {
  const rowsById = new Map(rows.map((row) => [row.ref.id, row]))
  const allCoveringRuleIds = new Set(rows.filter((row) => coveringSources.has(row.sourceName)).map((row) => row.ref.id))
  const offers = supportingCheckOffers(rowsById, byRule, allCoveringRuleIds)
  const everyOfferedRuleId = new Set([...offers.direct, ...offers.throughOtherRules].map((offer) => offer.ruleId))
  return {
    rows,
    mappingsByRule: byRule,
    selectedRuleIds: allCoveringRuleIds,
    automatedOnly: false,
    includedSupportingRuleIds: everyOfferedRuleId,
    supportingRuleIdsIfAdded: everyOfferedRuleId,
  }
}

export function combinedCoverage(
  rows: readonly RuleRow[],
  byRule: ReadonlyMap<string, MappedRule[]>,
  coveredSource: string,
  coveringSources: readonly string[],
  settings: SelectionSettings,
  scope: string,
): CappedCoverage {
  const coveringSourceSet = new Set(coveringSources)
  return {
    cap: frameworkCoverage(capInput(rows, byRule, coveringSourceSet), coveredSource, scope),
    selection: frameworkCoverage(selectionInput(rows, byRule, coveringSourceSet, settings), coveredSource, scope),
  }
}

export function pairCoverage(
  rows: readonly RuleRow[],
  byRule: ReadonlyMap<string, MappedRule[]>,
  pair: SupportsPair,
  settings: SelectionSettings,
  scope: string,
): CappedCoverage {
  return combinedCoverage(rows, byRule, pair.coveredSource, [pair.coveringSource], settings, scope)
}
