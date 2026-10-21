import { compareVersionsDescending, macosVersionLabel } from '../../logic/benchmarkLabels'
import { displayWithOdv } from '../../logic/odv'
import { assessmentLabel } from '../../logic/ruleDisplay'
import type { OrgDefinedValue } from '../../logic/selectionEntry'
import type { Architecture, Rule, RuleCheck } from '../../types/library'
import { CodeBlock, SectionHeading } from './CodeBlock'
import { DiscussionText } from './DiscussionText'

const ARCHITECTURE_LABELS: Record<NonNullable<Architecture>, string> = {
  arm64: 'Apple silicon (arm64)',
  i386: 'Intel (i386)',
}

const ODV_PLACEHOLDER = '$ODV'
const MAX_NOTE_VALUE_LENGTH = 80

// Banners run to hundreds of characters, which would swamp the check itself.
function shortenedValue(text: string): string {
  return text.length > MAX_NOTE_VALUE_LENGTH ? `${text.slice(0, MAX_NOTE_VALUE_LENGTH)}...` : text
}

function CheckEntry({ label, check, odvValue }: { label: string; check: RuleCheck; odvValue: OrgDefinedValue | null }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      {check.shell ? <CodeBlock code={check.shell} /> : <p className="text-xs text-slate-500">No check script.</p>}
      {check.shell?.includes(ODV_PLACEHOLDER) && (
        <p className="text-xs text-slate-500">
          $ODV stands for the organization-defined value, currently {shortenedValue(displayWithOdv(ODV_PLACEHOLDER, odvValue))}.
        </p>
      )}
      {check.result && (
        <p className="text-xs text-slate-600">
          Expected result ({check.result.type}):{' '}
          <code className="rounded bg-slate-200 px-1 font-mono break-all">
            {displayWithOdv(String(check.result.value), odvValue)}
          </code>
        </p>
      )}
      {check.additional_info && <DiscussionText text={check.additional_info} odvValue={odvValue} />}
    </div>
  )
}

export function RuleCheckSection({ rule, odvValue }: { rule: Rule; odvValue: OrgDefinedValue | null }) {
  const versionChecks = Object.entries(rule.check?.by_version ?? {}).sort(([left], [right]) =>
    compareVersionsDescending(left, right),
  )
  const hasNoVersion = Object.keys(rule.applicability).length === 0

  return (
    <div className="space-y-2">
      <SectionHeading>Check</SectionHeading>
      {hasNoVersion && <p className="text-xs text-amber-700">No macOS version listed: mSCP does not apply this rule to any release.</p>}
      {rule.architecture && (
        <p className="text-xs text-slate-600">
          Applies to {ARCHITECTURE_LABELS[rule.architecture]} Macs only; other Macs report a pass.
        </p>
      )}
      {!rule.check ? (
        <p className="text-xs text-slate-500">
          No automated check. {assessmentLabel(rule.assessment).description}
        </p>
      ) : (
        <>
          {rule.check.default ? (
            <CheckEntry
              label={versionChecks.length > 0 ? 'Default check (versions without their own)' : 'Check (all listed versions)'}
              check={rule.check.default}
              odvValue={odvValue}
            />
          ) : (
            <p className="text-xs text-slate-500">No default check; only the versions below have one.</p>
          )}
          {versionChecks.map(([version, check]) => (
            <CheckEntry key={version} label={macosVersionLabel(version)} check={check} odvValue={odvValue} />
          ))}
        </>
      )}
    </div>
  )
}
