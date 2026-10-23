import type { Applicability, Assessment } from '../types/library'
import { benchmarksAt } from './applicability'
import { compareBenchmarkFacetValues, membershipFacetValue, parseBenchmarkFacetValue } from './ruleFilters'
import { groupLabel, termDescription, termLabel, type VocabularyIndex } from './vocabulary'

export interface AssessmentLabel {
  label: string
  description: string | null
}

export function assessmentLabel(assessment: Assessment, index: VocabularyIndex): AssessmentLabel {
  if (assessment.status === 'automated') return { label: 'Automated', description: null }
  if (!assessment.manual_reason) return { label: 'Manual', description: 'Must be checked manually.' }

  const reason = assessment.manual_reason
  return {
    label: `Manual - ${termLabel(index, 'manual_reasons', reason)}`,
    description: termDescription(index, 'manual_reasons', reason) ?? reason,
  }
}

// Drops the leading words every version label shares (e.g. the product name),
// so a list of versions reads "A 15, 26" rather than repeating the prefix.
function versionListText(labels: string[]): string {
  if (labels.length < 2) return labels.join('')
  const wordLists = labels.map((label) => label.split(' '))
  let sharedWordCount = 0
  while (
    sharedWordCount < Math.min(...wordLists.map((words) => words.length)) - 1 &&
    wordLists.every((words) => words[sharedWordCount] === wordLists[0][sharedWordCount])
  ) {
    sharedWordCount += 1
  }
  return [labels[0], ...wordLists.slice(1).map((words) => words.slice(sharedWordCount).join(' '))].join(', ')
}

// The benchmarks a rule lists under `versionKeysInScope` (newest first), one
// item per benchmark group and severity, ordered as the benchmark facet
// orders them. An item missing from some of the versions in scope names the
// versions it does apply to. Grouped benchmark codes collapse into one item.
export function benchmarkSummary(applicability: Applicability, versionKeysInScope: readonly string[], index: VocabularyIndex): string {
  const versionsByItem = new Map<string, string[]>()
  for (const versionKey of versionKeysInScope) {
    for (const membership of benchmarksAt(applicability, versionKey)) {
      const itemKey = membershipFacetValue(membership, index)
      const itemVersions = versionsByItem.get(itemKey)
      if (itemVersions === undefined) versionsByItem.set(itemKey, [versionKey])
      else if (!itemVersions.includes(versionKey)) itemVersions.push(versionKey)
    }
  }

  const compareItems = compareBenchmarkFacetValues(index)
  return Array.from(versionsByItem.keys())
    .sort(compareItems)
    .map((itemKey) => {
      const { groupKey, severity } = parseBenchmarkFacetValue(itemKey)
      const benchmarkLabel = groupLabel(index, 'benchmarks', groupKey)
      const label = severity === null ? benchmarkLabel : `${benchmarkLabel} (${groupLabel(index, 'severities', severity)})`
      const itemVersions = versionsByItem.get(itemKey) ?? []
      if (itemVersions.length === versionKeysInScope.length) return label
      const versionLabels = Array.from(new Set(itemVersions.map((key) => termLabel(index, 'versions', key))))
      return `${label} on ${versionListText(versionLabels)}`
    })
    .join(' · ')
}

// v3 ids are "<source>.<upstream id>"; upstream ids never contain a dot.
export function upstreamRuleId(id: string): string {
  return id.slice(id.indexOf('.') + 1)
}
