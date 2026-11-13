// Structured pre-generation checks for the Generate screen: a fixed catalogue
// of checks, each with a stable id and severity, built from plain inputs so
// the screen only gathers data and renders the result.
import { KIND_LABELS } from './changeLabels'
import type { BlockedEntry } from './chunking'
import type { CustomChangeStatus } from './customChangeNotice'
import type { HistoryIndex } from './historyIndex'
import type { SkippedOverlay } from './overlays'
import { CHANGE_KINDS, type ChangeKind } from './ruleChanges'
import { upstreamRuleId } from './ruleDisplay'

export type CheckSeverity = 'error' | 'warning' | 'info'

export const GENERATE_CHECK_IDS = [
  'organization-value',
  'custom-changes-not-applied',
  'custom-changes-outdated',
  'custom-changes-older-release',
  'changed-in-newest-release',
  'history-unavailable',
] as const

export type GenerateCheckId = (typeof GENERATE_CHECK_IDS)[number]

export interface CheckOccurrence {
  ruleId: string
  title: string
  detail: string | null
  supportingCheck: boolean
}

export interface GenerateCheck {
  id: GenerateCheckId
  severity: CheckSeverity
  message: string
  occurrences: CheckOccurrence[]
}

export type CustomChangeResult =
  | { kind: 'compared'; status: CustomChangeStatus; releaseLabel: string }
  | { kind: 'unknown'; release: string }

export type NewestReleaseChange =
  | { kind: 'changed'; kinds: ChangeKind[]; previousLabel: string }
  | { kind: 'added'; currentLabel: string }

export interface GenerateCheckInput {
  blocked: readonly BlockedEntry[]
  skippedCustomChanges: readonly { ruleId: string; title: string; skipped: readonly SkippedOverlay[] }[]
  customChanges: readonly { ruleId: string; title: string; result: CustomChangeResult }[]
  newestReleaseChanges: readonly { ruleId: string; title: string; change: NewestReleaseChange }[]
  historyUnavailableSourceLabels: readonly string[]
}

const SEVERITY_BY_CHECK_ID: Record<GenerateCheckId, CheckSeverity> = {
  'organization-value': 'error',
  'custom-changes-not-applied': 'warning',
  'custom-changes-outdated': 'warning',
  'custom-changes-older-release': 'info',
  'changed-in-newest-release': 'info',
  'history-unavailable': 'info',
}

const SEVERITY_ORDER: readonly CheckSeverity[] = ['error', 'warning', 'info']

const STATIC_MESSAGES: Record<Exclude<GenerateCheckId, 'history-unavailable'>, string> = {
  'organization-value':
    "Fix these before generating: set a valid organization value in each rule's details on the browse screen.",
  'custom-changes-not-applied':
    'Custom changes could not be applied to these rules; they are shown and generated as imported.',
  'custom-changes-outdated':
    'Custom changes were written for an older release, and the rule has since changed in a field they touch. Review them before deploying.',
  'custom-changes-older-release':
    'Custom changes were written for an older release; the rule has not changed in any field they touch.',
  'changed-in-newest-release':
    'Changed in the newest release of its framework. What it checks or where it applies may differ from earlier bundles.',
}

const SUPPORTING_CHECK_VALUE_HINT = 'For supporting checks, set the value under Supporting checks below.'

const KINDS_THAT_CHANGE_THE_CHECK: readonly ChangeKind[] = ['behaviour', 'scope']

export function newestReleaseChange(history: HistoryIndex, ruleId: string): NewestReleaseChange | null {
  if (history.releases.length < 2) return null
  const entry = history.rules[ruleId]
  if (!entry) return null
  const currentPosition = history.releases.length - 1
  const current = entry.versions[currentPosition]
  if (!current) return null
  const previous = entry.versions[currentPosition - 1]
  if (!previous) return { kind: 'added', currentLabel: history.releases[currentPosition].label }
  const kinds = CHANGE_KINDS.filter(
    (kind) => KINDS_THAT_CHANGE_THE_CHECK.includes(kind) && previous[kind] !== current[kind],
  )
  if (kinds.length === 0) return null
  return { kind: 'changed', kinds, previousLabel: history.releases[currentPosition - 1].label }
}

function compareOccurrences(first: CheckOccurrence, second: CheckOccurrence): number {
  const byRule = upstreamRuleId(first.ruleId).localeCompare(upstreamRuleId(second.ruleId))
  if (byRule !== 0) return byRule
  return (first.detail ?? '').localeCompare(second.detail ?? '')
}

function customChangeOccurrence(entry: GenerateCheckInput['customChanges'][number]): CheckOccurrence {
  const { ruleId, title, result } = entry
  if (result.kind === 'unknown') {
    return { ruleId, title, detail: `Written for ${result.release}; could not compare with the release history.`, supportingCheck: false }
  }
  if (result.status.kind === 'touched') {
    return { ruleId, title, detail: `Written for ${result.releaseLabel}; changed: ${result.status.labels.join(', ')}`, supportingCheck: false }
  }
  return { ruleId, title, detail: `Written for ${result.releaseLabel}`, supportingCheck: false }
}

function isOutdated(result: CustomChangeResult): boolean {
  return result.kind === 'unknown' || result.status.kind === 'touched'
}

function newestReleaseDetail(change: NewestReleaseChange): string {
  if (change.kind === 'added') return `New in ${change.currentLabel}`
  return `${change.kinds.map((kind) => KIND_LABELS[kind]).join(', ')} since ${change.previousLabel}`
}

export function buildGenerateChecks(input: GenerateCheckInput): GenerateCheck[] {
  const occurrencesById: Record<Exclude<GenerateCheckId, 'history-unavailable'>, CheckOccurrence[]> = {
    'organization-value': input.blocked.map(({ id, title, reason, supportingCheck }) => ({
      ruleId: id,
      title,
      detail: supportingCheck ? `${reason} (supporting check)` : reason,
      supportingCheck,
    })),
    'custom-changes-not-applied': input.skippedCustomChanges.flatMap(({ ruleId, title, skipped }) =>
      skipped.map(({ overlayId, message }) => ({ ruleId, title, detail: `${overlayId}: ${message}`, supportingCheck: false })),
    ),
    'custom-changes-outdated': input.customChanges
      .filter((entry) => isOutdated(entry.result))
      .map(customChangeOccurrence),
    'custom-changes-older-release': input.customChanges
      .filter((entry) => !isOutdated(entry.result))
      .map(customChangeOccurrence),
    'changed-in-newest-release': input.newestReleaseChanges.map(({ ruleId, title, change }) => ({
      ruleId,
      title,
      detail: newestReleaseDetail(change),
      supportingCheck: false,
    })),
  }

  const checks: GenerateCheck[] = []
  for (const id of GENERATE_CHECK_IDS) {
    if (id === 'history-unavailable') {
      if (input.historyUnavailableSourceLabels.length === 0) continue
      checks.push({
        id,
        severity: SEVERITY_BY_CHECK_ID[id],
        message: `Release history could not be loaded for ${input.historyUnavailableSourceLabels.join(', ')}, so release checks were skipped for their rules.`,
        occurrences: [],
      })
      continue
    }
    const occurrences = occurrencesById[id]
    if (occurrences.length === 0) continue
    checks.push({
      id,
      severity: SEVERITY_BY_CHECK_ID[id],
      message: id === 'organization-value' && occurrences.some((occurrence) => occurrence.supportingCheck)
        ? `${STATIC_MESSAGES[id]} ${SUPPORTING_CHECK_VALUE_HINT}`
        : STATIC_MESSAGES[id],
      occurrences: [...occurrences].sort(compareOccurrences),
    })
  }

  // Array.prototype.sort is stable, so equal severities keep catalogue order.
  return checks.sort((first, second) => SEVERITY_ORDER.indexOf(first.severity) - SEVERITY_ORDER.indexOf(second.severity))
}

export function hasBlockingCheck(checks: readonly GenerateCheck[]): boolean {
  return checks.some((check) => check.severity === 'error')
}

export function severityCounts(checks: readonly GenerateCheck[]): Record<CheckSeverity, number> {
  const counts: Record<CheckSeverity, number> = { error: 0, warning: 0, info: 0 }
  for (const check of checks) counts[check.severity] += 1
  return counts
}
