// Framework pairs and capped coverage (docs/plans/2026-11-18-unified-frameworks-design.md,
// "Coverage reports"): which frameworks support or relate to which, and for each supports
// pair how much of the covered framework could be reached (the cap) next to how much the
// user's selection reaches.

import type { RuleRow } from '../types/rule-row'
import { compareText } from './catalogIndex'
import { supportChain } from './indirectMappings'
import type { MappedRule } from './mappingIndex'
import { ALL_CONTROLS_SCOPE, frameworkCoverage, type CoverageInput, type FrameworkCoverage } from './selectionCoverage'
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

// Related partners are left out: the combined report counts only frameworks that support the
// covered one, so a related-only partner never makes it a duplicate of a single pair's report.
export function supportingSourcesOf(pairs: readonly FrameworkPair[], coveredSource: string): string[] {
  const supportingSources = pairs
    .filter((pair): pair is SupportsPair => pair.kind === 'supports' && pair.coveredSource === coveredSource)
    .map((pair) => pair.coveringSource)
  return [...new Set(supportingSources)].sort(compareText)
}

export function supportsPairsCovering(pairs: readonly FrameworkPair[], coveringSource: string): SupportsPair[] {
  return pairs.filter((pair): pair is SupportsPair => pair.kind === 'supports' && pair.coveringSource === coveringSource)
}

export function capCount(coverage: Pick<FrameworkCoverage, 'covered' | 'coveredThroughSupporting'>): number {
  return coverage.covered + coverage.coveredThroughSupporting
}

function selectionInput(
  rows: readonly RuleRow[],
  byRule: ReadonlyMap<string, MappedRule[]>,
  restrictToSources: ReadonlySet<string> | null,
  settings: SelectionSettings,
): CoverageInput {
  const rowsById = new Map(rows.map((row) => [row.ref.id, row]))
  const effectiveRuleIds =
    restrictToSources === null
      ? new Set(settings.selectedRuleIds)
      : new Set(
          [...settings.selectedRuleIds].filter((ruleId) => {
            const sourceName = rowsById.get(ruleId)?.sourceName
            return sourceName !== undefined && restrictToSources.has(sourceName)
          }),
        )
  const offers = supportingCheckOffers(rowsById, byRule, effectiveRuleIds)
  return {
    rows,
    mappingsByRule: byRule,
    selectedRuleIds: effectiveRuleIds,
    automatedOnly: settings.automatedOnly,
    includedSupportingRuleIds: new Set(includedSupportingRuleIds(offers, settings.choices)),
    supportingRuleIdsIfAdded: new Set(wouldIncludeSupportingRuleIds(offers, settings.choices)),
  }
}

function capInput(
  rows: readonly RuleRow[],
  byRule: ReadonlyMap<string, MappedRule[]>,
  coveringSources: ReadonlySet<string>,
  automatedOnly: boolean,
): CoverageInput {
  const rowsById = new Map(rows.map((row) => [row.ref.id, row]))
  const allCoveringRuleIds = new Set(rows.filter((row) => coveringSources.has(row.sourceName)).map((row) => row.ref.id))
  const offers = supportingCheckOffers(rowsById, byRule, allCoveringRuleIds)
  const everyOfferedRuleId = new Set([...offers.direct, ...offers.throughOtherRules].map((offer) => offer.ruleId))
  return {
    rows,
    mappingsByRule: byRule,
    selectedRuleIds: allCoveringRuleIds,
    automatedOnly,
    includedSupportingRuleIds: everyOfferedRuleId,
    supportingRuleIdsIfAdded: everyOfferedRuleId,
  }
}

function cappedCoverage(
  rows: readonly RuleRow[],
  byRule: ReadonlyMap<string, MappedRule[]>,
  coveredSource: string,
  coveringSources: ReadonlySet<string>,
  selectionRestriction: ReadonlySet<string> | null,
  settings: SelectionSettings,
  scope: string,
): CappedCoverage {
  return {
    cap: frameworkCoverage(capInput(rows, byRule, coveringSources, settings.automatedOnly), coveredSource, scope),
    selection: frameworkCoverage(selectionInput(rows, byRule, selectionRestriction, settings), coveredSource, scope),
  }
}

// The combined report shows what the user's whole selection reaches, whichever framework it came from.
export function combinedCoverage(
  rows: readonly RuleRow[],
  byRule: ReadonlyMap<string, MappedRule[]>,
  coveredSource: string,
  coveringSources: readonly string[],
  settings: SelectionSettings,
  scope: string,
): CappedCoverage {
  return cappedCoverage(rows, byRule, coveredSource, new Set(coveringSources), null, settings, scope)
}

export function pairCoverage(
  rows: readonly RuleRow[],
  byRule: ReadonlyMap<string, MappedRule[]>,
  pair: SupportsPair,
  settings: SelectionSettings,
  scope: string,
): CappedCoverage {
  const coveringSources = new Set([pair.coveringSource])
  return cappedCoverage(rows, byRule, pair.coveredSource, coveringSources, coveringSources, settings, scope)
}

// The user's whole selection, for the "selected rules that support no control" list.
export function selectionCoverageInput(rows: readonly RuleRow[], byRule: ReadonlyMap<string, MappedRule[]>, settings: SelectionSettings): CoverageInput {
  return selectionInput(rows, byRule, null, settings)
}

// Related links never count as coverage, so this is a fact about the mappings: it ignores the
// selection and Automated checks only.
export function relatedPairCoverage(
  rows: readonly RuleRow[],
  byRule: ReadonlyMap<string, MappedRule[]>,
  relatedSource: string,
  ofSource: string,
): FrameworkCoverage {
  const everyRelatedSourceRuleId = new Set(rows.filter((row) => row.sourceName === relatedSource).map((row) => row.ref.id))
  const input: CoverageInput = {
    rows,
    mappingsByRule: byRule,
    selectedRuleIds: everyRelatedSourceRuleId,
    automatedOnly: false,
    includedSupportingRuleIds: new Set(),
    supportingRuleIdsIfAdded: new Set(),
  }
  return frameworkCoverage(input, ofSource, ALL_CONTROLS_SCOPE)
}

export interface WithinReach {
  capCount: number
  direct: number
  throughSupporting: number
  percentOfCap: number
  stillToGo: number
}

export function withinReach(coverage: FrameworkCoverage, cap: FrameworkCoverage): WithinReach {
  const capTotal = capCount(cap)
  const reached = capCount(coverage)
  return {
    capCount: capTotal,
    direct: coverage.covered,
    throughSupporting: coverage.coveredThroughSupporting,
    percentOfCap: capTotal === 0 ? 0 : Math.round((reached / capTotal) * 100),
    stillToGo: capTotal - reached,
  }
}
