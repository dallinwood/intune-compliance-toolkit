import type { Applicability, Assessment, ManualReason } from '../types/library'
import { benchmarkLabel } from './benchmarkLabels'

// mSCP's own baseline order: core OS settings first, supplemental guidance last.
const SECTION_ORDER = ['os', 'system_settings', 'pwpolicy', 'auth', 'audit', 'icloud', 'supplemental']

const SECTION_LABELS: Record<string, string> = {
  os: 'Operating system',
  system_settings: 'System Settings',
  pwpolicy: 'Password policy',
  auth: 'Authentication',
  audit: 'Auditing',
  icloud: 'iCloud',
  supplemental: 'Supplemental',
}

export function compareSections(left: string, right: string): number {
  const leftRank = SECTION_ORDER.indexOf(left)
  const rightRank = SECTION_ORDER.indexOf(right)
  if (leftRank !== -1 && rightRank !== -1) return leftRank - rightRank
  if (leftRank !== -1) return -1
  if (rightRank !== -1) return 1
  return left.localeCompare(right)
}

export function sectionLabel(section: string): string {
  return SECTION_LABELS[section] ?? section
}

const MANUAL_REASONS: Record<ManualReason, { suffix: string | null; description: string }> = {
  manual: { suffix: null, description: 'mSCP marks this rule for manual review.' },
  inherent: { suffix: 'inherent', description: 'macOS meets this requirement inherently; there is nothing to configure.' },
  permanent: { suffix: 'permanent', description: 'macOS cannot meet this requirement; it is a permanent finding.' },
  n_a: { suffix: 'n/a', description: 'mSCP marks this requirement as not applicable to macOS.' },
  supplemental: { suffix: 'supplemental', description: 'Supplemental guidance rather than a checkable rule.' },
  no_check: { suffix: 'no check', description: 'mSCP provides no automated check for this rule.' },
}

export interface AssessmentLabel {
  label: string
  description: string | null
}

export function assessmentLabel(assessment: Assessment): AssessmentLabel {
  if (assessment.status === 'automated') return { label: 'Automated', description: null }
  if (!assessment.manual_reason) return { label: 'Manual', description: 'Must be checked manually.' }

  const reason = MANUAL_REASONS[assessment.manual_reason]
  return { label: reason.suffix ? `Manual - ${reason.suffix}` : 'Manual', description: reason.description }
}

// `osVersions` is newest first (see buildRuleRows), so its first entry is
// the version whose benchmark list is shown.
export function benchmarkSummary(applicability: Applicability, osVersions: readonly string[]): string {
  const newestVersion = osVersions[0]
  if (newestVersion === undefined) return ''
  return (applicability[newestVersion] ?? [])
    .map((benchmark) =>
      benchmark.severity ? `${benchmarkLabel(benchmark.name)} (${benchmark.severity})` : benchmarkLabel(benchmark.name),
    )
    .join(', ')
}

// v3 ids are "<source>.<upstream id>"; upstream ids never contain a dot.
export function upstreamRuleId(id: string): string {
  return id.slice(id.indexOf('.') + 1)
}
