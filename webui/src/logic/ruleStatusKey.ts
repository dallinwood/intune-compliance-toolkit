import type { RuleRow } from '../types/rule-row'
import type { MappedRule } from './mappingIndex'
import { linkStatusCounts, targetStatus, type CheckStatus } from './ruleStatusIcons'
import { targetIconsOf } from './targetIcons'

export interface StatusKeyEntry {
  kind: 'target' | 'no-target' | 'link'
  targetName?: string
  status: CheckStatus
  text: string
}

export interface StatusKeyGroup {
  heading: 'Automated check' | 'Manual check' | 'Linked rules'
  entries: StatusKeyEntry[]
}

const CHECK_HEADINGS: Record<CheckStatus, StatusKeyGroup['heading']> = {
  automated: 'Automated check',
  manual: 'Manual check',
}

function platformEntries(rows: readonly RuleRow[], status: CheckStatus): StatusKeyEntry[] {
  const labelsByTargetName = new Map<string, string>()
  let hasNoPlatformRule = false
  for (const row of rows) {
    const targetIcons = targetIconsOf(row.targetKeys)
    if (targetIcons.length === 0 && row.assessment.status === status) hasNoPlatformRule = true
    for (const { targetName, label } of targetIcons) {
      if (targetStatus(row, targetName) === status) labelsByTargetName.set(targetName, label)
    }
  }
  const platforms = [...labelsByTargetName.entries()]
    .sort(([, leftLabel], [, rightLabel]) => leftLabel.localeCompare(rightLabel, 'en'))
    .map(([targetName, label]): StatusKeyEntry => ({ kind: 'target', targetName, status, text: label }))
  return hasNoPlatformRule ? [...platforms, { kind: 'no-target', status, text: 'No platform' }] : platforms
}

function linkEntries(
  rows: readonly RuleRow[],
  byRule: ReadonlyMap<string, MappedRule[]>,
  rowsById: ReadonlyMap<string, RuleRow>,
): StatusKeyEntry[] {
  const linkedStatuses = new Set<CheckStatus>()
  for (const row of rows) {
    const counts = linkStatusCounts(row.ref.id, byRule, rowsById)
    if (counts.automated > 0) linkedStatuses.add('automated')
    if (counts.manual > 0) linkedStatuses.add('manual')
  }
  return (['automated', 'manual'] as const)
    .filter((status) => linkedStatuses.has(status))
    .map((status): StatusKeyEntry => ({ kind: 'link', status, text: `Linked to ${status} rules` }))
}

// Only the icons the given rows can show, grouped by meaning.
export function statusKeyGroups(
  rows: readonly RuleRow[],
  byRule: ReadonlyMap<string, MappedRule[]>,
  rowsById: ReadonlyMap<string, RuleRow>,
): StatusKeyGroup[] {
  const groups: StatusKeyGroup[] = [
    { heading: CHECK_HEADINGS.automated, entries: platformEntries(rows, 'automated') },
    { heading: CHECK_HEADINGS.manual, entries: platformEntries(rows, 'manual') },
    { heading: 'Linked rules', entries: linkEntries(rows, byRule, rowsById) },
  ]
  return groups.filter((group) => group.entries.length > 0)
}
