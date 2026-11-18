// The compact coverage block on a framework card (design doc, "Home: framework cards"): every
// pair the framework belongs to, with the cap and the user's selection at the all-controls scope.

import type { RuleRow } from '../types/rule-row'
import {
  combinedCoverage,
  supportingSourcesOf,
  pairCoverage,
  relatedPairCoverage,
  type CappedCoverage,
  type FrameworkPair,
  type SelectionSettings,
  type SupportsPair,
} from './frameworkPairs'
import type { MappedRule } from './mappingIndex'
import { ALL_CONTROLS_SCOPE, type FrameworkCoverage } from './selectionCoverage'

export interface CardCoverage {
  covers: { coveredSource: string; capped: CappedCoverage }[]
  coveredBy: { coveringSource: string; capped: CappedCoverage }[]
  related: { otherSource: string; coverage: FrameworkCoverage }[]
  combined: CappedCoverage | null
}

export function cardCoverages(
  sourceNames: readonly string[],
  rows: readonly RuleRow[],
  byRule: ReadonlyMap<string, MappedRule[]>,
  pairs: readonly FrameworkPair[],
  settings: SelectionSettings,
): Map<string, CardCoverage> {
  const supportsPairs = pairs.filter((pair): pair is SupportsPair => pair.kind === 'supports')
  const cappedByPair = new Map(supportsPairs.map((pair) => [pair, pairCoverage(rows, byRule, pair, settings, ALL_CONTROLS_SCOPE)]))
  return new Map(
    sourceNames.map((sourceName) => {
      const supportingSources = supportingSourcesOf(pairs, sourceName)
      const coverage: CardCoverage = {
        covers: supportsPairs.filter((pair) => pair.coveringSource === sourceName).map((pair) => ({ coveredSource: pair.coveredSource, capped: cappedByPair.get(pair)! })),
        coveredBy: supportsPairs.filter((pair) => pair.coveredSource === sourceName).map((pair) => ({ coveringSource: pair.coveringSource, capped: cappedByPair.get(pair)! })),
        related: pairs.flatMap((pair) => {
          if (pair.kind !== 'related' || !pair.sources.includes(sourceName)) return []
          const otherSource = pair.sources[0] === sourceName ? pair.sources[1] : pair.sources[0]
          return [{ otherSource, coverage: relatedPairCoverage(rows, byRule, otherSource, sourceName) }]
        }),
        combined: supportingSources.length >= 2 ? combinedCoverage(rows, byRule, sourceName, supportingSources, settings, ALL_CONTROLS_SCOPE) : null,
      }
      return [sourceName, coverage]
    }),
  )
}
