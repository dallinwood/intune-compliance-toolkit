// The compact coverage block on a framework card (design doc, "Home: framework cards"): every
// pair the framework belongs to, with the cap and the user's selection at the all-controls scope.

import type { RuleRow } from '../types/rule-row'
import {
  combinedCap,
  combinedSelection,
  pairCap,
  pairSelection,
  relatedPairCoverage,
  supportingSourcesOf,
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

// What each pair and each combined report could reach, which a card shows next to the
// selection. Independent of the selection, so a selection change does not recompute it.
export interface CardCaps {
  byPair: ReadonlyMap<SupportsPair, FrameworkCoverage>
  combinedBySource: ReadonlyMap<string, FrameworkCoverage>
}

export function cardCaps(
  sourceNames: readonly string[],
  rows: readonly RuleRow[],
  byRule: ReadonlyMap<string, MappedRule[]>,
  pairs: readonly FrameworkPair[],
): CardCaps {
  const byPair = new Map(
    pairs.filter((pair): pair is SupportsPair => pair.kind === 'supports').map((pair) => [pair, pairCap(rows, byRule, pair, false, ALL_CONTROLS_SCOPE)]),
  )
  const combinedBySource = new Map<string, FrameworkCoverage>()
  for (const sourceName of sourceNames) {
    const supportingSources = supportingSourcesOf(pairs, sourceName)
    if (supportingSources.length >= 2) combinedBySource.set(sourceName, combinedCap(rows, byRule, sourceName, supportingSources, false, ALL_CONTROLS_SCOPE))
  }
  return { byPair, combinedBySource }
}

// The settings' automatedOnly must be the false that cardCaps was computed with.
export function cardCoverages(
  sourceNames: readonly string[],
  rows: readonly RuleRow[],
  byRule: ReadonlyMap<string, MappedRule[]>,
  pairs: readonly FrameworkPair[],
  settings: SelectionSettings,
  caps: CardCaps = cardCaps(sourceNames, rows, byRule, pairs),
): Map<string, CardCoverage> {
  const supportsPairs = pairs.filter((pair): pair is SupportsPair => pair.kind === 'supports')
  const cappedByPair = new Map(
    supportsPairs.map((pair) => [pair, { cap: caps.byPair.get(pair)!, selection: pairSelection(rows, byRule, pair, settings, ALL_CONTROLS_SCOPE) }]),
  )
  return new Map(
    sourceNames.map((sourceName) => {
      const combinedCapCoverage = caps.combinedBySource.get(sourceName)
      const coverage: CardCoverage = {
        covers: supportsPairs.filter((pair) => pair.coveringSource === sourceName).map((pair) => ({ coveredSource: pair.coveredSource, capped: cappedByPair.get(pair)! })),
        coveredBy: supportsPairs.filter((pair) => pair.coveredSource === sourceName).map((pair) => ({ coveringSource: pair.coveringSource, capped: cappedByPair.get(pair)! })),
        related: pairs.flatMap((pair) => {
          if (pair.kind !== 'related' || !pair.sources.includes(sourceName)) return []
          const otherSource = pair.sources[0] === sourceName ? pair.sources[1] : pair.sources[0]
          return [{ otherSource, coverage: relatedPairCoverage(rows, byRule, otherSource, sourceName) }]
        }),
        combined:
          combinedCapCoverage === undefined
            ? null
            : { cap: combinedCapCoverage, selection: combinedSelection(rows, byRule, sourceName, settings, ALL_CONTROLS_SCOPE) },
      }
      return [sourceName, coverage]
    }),
  )
}
