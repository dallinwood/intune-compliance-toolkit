import type { Applicability, Assessment } from '../types/library'
import { termDescription, termLabel, type VocabularyIndex } from './vocabulary'

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

// `osVersions` is newest first (see buildRuleRows), so its first entry is
// the version whose benchmark list is shown. Grouped benchmark codes listed
// together would read twice, so repeated text is dropped.
export function benchmarkSummary(applicability: Applicability, osVersions: readonly string[], index: VocabularyIndex): string {
  const newestVersion = osVersions[0]
  if (newestVersion === undefined) return ''
  const parts = (applicability[newestVersion] ?? []).map((benchmark) => {
    const label = termLabel(index, 'benchmarks', benchmark.name)
    return benchmark.severity ? `${label} (${benchmark.severity})` : label
  })
  return Array.from(new Set(parts)).join(', ')
}

// v3 ids are "<source>.<upstream id>"; upstream ids never contain a dot.
export function upstreamRuleId(id: string): string {
  return id.slice(id.indexOf('.') + 1)
}
