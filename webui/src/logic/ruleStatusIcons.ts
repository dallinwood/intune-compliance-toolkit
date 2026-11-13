import type { RuleRow } from '../types/rule-row'
import type { MappedRule } from './mappingIndex'
import { targetIconsOf } from './targetIcons'
import { termLabel, type VocabularyIndex } from './vocabulary'

export type CheckStatus = 'automated' | 'manual'

export interface StatusIcon {
  kind: 'target' | 'no-target' | 'link'
  targetName?: string
  status: CheckStatus
  label: string
}

export interface LinkStatusCounts {
  automated: number
  manual: number
}

// The index carries one assessment per rule, not one per target, so every
// target shows the rule's status (exact while no rule has two targets).
export function targetStatus(row: RuleRow, _targetName: string): CheckStatus {
  return row.assessment.status
}

export function linkStatusCounts(
  ruleId: string,
  byRule: ReadonlyMap<string, MappedRule[]>,
  rowsById: ReadonlyMap<string, RuleRow>,
): LinkStatusCounts {
  const linkedRuleIds = new Set((byRule.get(ruleId) ?? []).map((link) => link.rule))
  linkedRuleIds.delete(ruleId)
  const counts: LinkStatusCounts = { automated: 0, manual: 0 }
  for (const linkedRuleId of linkedRuleIds) {
    const linkedRow = rowsById.get(linkedRuleId)
    if (linkedRow) counts[linkedRow.assessment.status] += 1
  }
  return counts
}

function checkWord(status: CheckStatus): string {
  return status === 'automated' ? 'automated check' : 'manual check'
}

function withReason(label: string, row: RuleRow, index: VocabularyIndex): string {
  const reason = row.assessment.manual_reason
  return reason ? `${label} - ${termLabel(index, 'manual_reasons', reason)}` : label
}

function linkIcon(status: CheckStatus, count: number): StatusIcon[] {
  if (count === 0) return []
  return [{ kind: 'link', status, label: `Linked to ${count} ${status} ${count === 1 ? 'rule' : 'rules'}` }]
}

export function rowStatusIcons(row: RuleRow, linkCounts: LinkStatusCounts, index: VocabularyIndex): StatusIcon[] {
  const targetIcons = targetIconsOf(row.targetKeys)
  const platformIcons: StatusIcon[] =
    targetIcons.length > 0
      ? targetIcons.map(({ targetName, label }) => {
          const status = targetStatus(row, targetName)
          return { kind: 'target', targetName, status, label: withReason(`${label}: ${checkWord(status)}`, row, index) }
        })
      : [{ kind: 'no-target', status: row.assessment.status, label: withReason(`No platform: ${row.assessment.status}`, row, index) }]
  return [...platformIcons, ...linkIcon('automated', linkCounts.automated), ...linkIcon('manual', linkCounts.manual)]
}

export function stripAccessibleName(icons: readonly StatusIcon[]): string {
  return icons.map((icon) => icon.label).join('. ')
}
