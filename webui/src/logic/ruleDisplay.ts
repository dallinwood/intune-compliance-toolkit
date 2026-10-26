import type { Applicability, Assessment } from '../types/library'
import { NONE_LABEL, NO_VERSION_KEY, benchmarksAt, scopeKeysOf } from './applicability'
import { compareBenchmarkFacetValues, membershipFacetValue, parseBenchmarkFacetValue } from './ruleFilters'
import { groupLabel, termDescription, termLabel, type VocabularyIndex } from './vocabulary'

const ANY_PLATFORM_LABEL = 'Any platform'

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

// The benchmarks a rule lists under `scopeKeysInScope` (newest first, "none"
// last), one item per benchmark group and severity, ordered as the benchmark
// facet orders them. An item missing from some of the versions in scope names
// the versions it does apply to. Grouped benchmark codes collapse into one item.
export function benchmarkSummary(applicability: Applicability, scopeKeysInScope: readonly string[], index: VocabularyIndex): string {
  const versionsByItem = new Map<string, string[]>()
  for (const scopeKey of scopeKeysInScope) {
    for (const membership of benchmarksAt(applicability, scopeKey)) {
      const itemKey = membershipFacetValue(membership, index)
      const itemVersions = versionsByItem.get(itemKey)
      if (itemVersions === undefined) versionsByItem.set(itemKey, [scopeKey])
      else if (!itemVersions.includes(scopeKey)) itemVersions.push(scopeKey)
    }
  }

  const compareItems = compareBenchmarkFacetValues(index)
  return Array.from(versionsByItem.keys())
    .sort(compareItems)
    .map((itemKey) => {
      const label = membershipLabel(itemKey, index)
      const itemVersions = versionsByItem.get(itemKey) ?? []
      if (itemVersions.length === scopeKeysInScope.length) return label
      const versionLabels = Array.from(new Set(itemVersions.map((key) => (key === NO_VERSION_KEY ? NONE_LABEL : termLabel(index, 'versions', key)))))
      return `${label} on ${versionListText(versionLabels)}`
    })
    .join(' · ')
}

function membershipLabel(itemKey: string, index: VocabularyIndex): string {
  const { groupKey, severity } = parseBenchmarkFacetValue(itemKey)
  const benchmarkLabel = groupLabel(index, 'benchmarks', groupKey)
  return severity === null ? benchmarkLabel : `${benchmarkLabel} (${groupLabel(index, 'severities', severity)})`
}

export interface ScopeBenchmarks {
  scopeKey: string
  // null when the rule's only scope is "any platform, no version", where a
  // heading would only say nothing; the benchmarks are then listed bare.
  scopeLabel: string | null
  benchmarks: string[]
}

// The unversioned scope pools every entry with no version, so its heading
// names the targets among them rather than a bare "None".
export function unversionedScopeLabel(applicability: Applicability, index: VocabularyIndex): string {
  const targets = [...new Set(applicability.filter((entry) => entry.version === null).flatMap((entry) => (entry.target === null ? [] : [entry.target])))]
  if (targets.length === 0) return ANY_PLATFORM_LABEL
  return `${targets.map((target) => termLabel(index, 'targets', target)).join(' and ')}, no specific version`
}

// Every benchmark membership of a rule, grouped by version (newest first,
// unversioned last). Versions with no benchmark are left out.
export function benchmarksByScope(applicability: Applicability, index: VocabularyIndex): ScopeBenchmarks[] {
  const compareItems = compareBenchmarkFacetValues(index)
  const scopes = scopeKeysOf(applicability).flatMap((scopeKey) => {
    const itemKeys = Array.from(new Set(benchmarksAt(applicability, scopeKey).map((membership) => membershipFacetValue(membership, index))))
    if (itemKeys.length === 0) return []
    return [
      {
        scopeKey,
        scopeLabel: scopeKey === NO_VERSION_KEY ? unversionedScopeLabel(applicability, index) : termLabel(index, 'versions', scopeKey),
        benchmarks: itemKeys.sort(compareItems).map((itemKey) => membershipLabel(itemKey, index)),
      },
    ]
  })
  const [onlyScope] = scopes
  if (scopes.length === 1 && onlyScope.scopeLabel === ANY_PLATFORM_LABEL) return [{ ...onlyScope, scopeLabel: null }]
  return scopes
}

// Rule ids are "<source>.<upstream id>"; upstream ids never contain a dot.
export function upstreamRuleId(id: string): string {
  return id.slice(id.indexOf('.') + 1)
}
