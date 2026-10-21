import type { ManualReason, Rule } from '../types/library'
import type { ManualAttestationEntry } from './chunking'
import { displayWithOdv } from './odv'
import { upstreamRuleId } from './ruleDisplay'
import type { OrgDefinedValue } from './selectionEntry'

const MANUAL_REASON_TEXT: Record<ManualReason, string> = {
  inherent: 'Met by macOS by design (mSCP: inherent).',
  permanent: 'Cannot be configured on macOS; mSCP lists this as a permanent finding.',
  n_a: 'Not applicable to macOS (mSCP: n_a).',
  supplemental: 'Supplemental guidance with no check.',
  manual: 'mSCP marks this check as manual.',
  no_check: 'mSCP provides no automated check.',
}

// The schema allows a manual rule without a reason even though no current
// mSCP rule has one; it is then treated like an explicit "manual".
export function manualReasonText(manualReason: ManualReason | null): string {
  return MANUAL_REASON_TEXT[manualReason ?? 'manual']
}

export function additionalInfoFor(rule: Rule, odvValue: OrgDefinedValue | null): string | null {
  const additionalInfo = rule.check?.default?.additional_info?.trim()
  return additionalInfo ? displayWithOdv(additionalInfo, odvValue) : null
}

const ATTRIBUTION =
  'Rule content from the NIST macOS Security Compliance Project (https://github.com/usnistgov/macos_security), ' +
  'licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Content modified by this project.'

function indentContinuation(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : `  ${line}`))
    .join('\n')
}

export function buildManualAttestationMarkdown(entries: ManualAttestationEntry[]): string {
  const lines = ['# Manual attestation', '']
  if (entries.length === 0) {
    lines.push('No selected rules need manual attestation.', '')
  } else {
    lines.push('The generated discovery scripts do not check these selected rules. Verify each one manually.', '')
    for (const entry of entries) {
      lines.push(`- **${upstreamRuleId(entry.id)}** - ${entry.title}`, '', indentContinuation(entry.reason), '')
      if (entry.additionalInfo) lines.push(indentContinuation(entry.additionalInfo), '')
    }
  }
  lines.push('---', '', ATTRIBUTION)
  return lines.join('\n') + '\n'
}
