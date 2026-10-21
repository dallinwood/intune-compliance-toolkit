import { compareVersionsDescending, macosVersionLabel } from '../../logic/benchmarkLabels'
import type { OrgDefinedValue } from '../../logic/selectionEntry'
import type { RemediationEntry, Rule } from '../../types/library'
import { CodeBlock, SectionHeading } from './CodeBlock'
import { DiscussionText } from './DiscussionText'

function hasContent(entry: RemediationEntry): boolean {
  return entry.shell !== null || entry.additional_info !== null
}

function FixEntry({ label, entry, odvValue }: { label: string; entry: RemediationEntry; odvValue: OrgDefinedValue | null }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      {entry.shell && <CodeBlock code={entry.shell} />}
      {entry.additional_info && <DiscussionText text={entry.additional_info} odvValue={odvValue} />}
    </div>
  )
}

function JsonEntry({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <CodeBlock code={JSON.stringify(value, null, 2)} />
    </div>
  )
}

export function RuleRemediationSection({ rule, odvValue }: { rule: Rule; odvValue: OrgDefinedValue | null }) {
  const remediation = rule.remediation
  const versionFixes = Object.entries(remediation.by_version)
    .filter(([, entry]) => hasContent(entry))
    .sort(([left], [right]) => compareVersionsDescending(left, right))
  const versionProfiles = Object.entries(remediation.mobileconfig_by_version).sort(([left], [right]) =>
    compareVersionsDescending(left, right),
  )
  const hasAnything =
    hasContent(remediation.default) ||
    versionFixes.length > 0 ||
    remediation.mobileconfig_info !== null ||
    versionProfiles.length > 0 ||
    remediation.ddm_info !== null

  return (
    <div className="space-y-2">
      <SectionHeading>Remediation</SectionHeading>
      {!hasAnything && <p className="text-xs text-slate-500">No remediation provided.</p>}
      {hasContent(remediation.default) && (
        <FixEntry
          label={versionFixes.length > 0 ? 'Fix (versions without their own)' : 'Fix'}
          entry={remediation.default}
          odvValue={odvValue}
        />
      )}
      {versionFixes.map(([version, entry]) => (
        <FixEntry key={version} label={`Fix for ${macosVersionLabel(version)}`} entry={entry} odvValue={odvValue} />
      ))}
      {remediation.mobileconfig_info !== null && (
        <JsonEntry
          label={versionProfiles.length > 0 ? 'Configuration profile payloads (versions without their own)' : 'Configuration profile payloads'}
          value={remediation.mobileconfig_info}
        />
      )}
      {versionProfiles.map(([version, payloads]) => (
        <JsonEntry key={version} label={`Configuration profile payloads for ${macosVersionLabel(version)}`} value={payloads} />
      ))}
      {remediation.ddm_info !== null && <JsonEntry label="Declarative Device Management" value={remediation.ddm_info} />}
    </div>
  )
}
