import { versionKey, versionsForTarget } from '../../logic/applicability'
import { GENERATED_TARGET } from '../../logic/checkPlan'
import { containsOdvPlaceholder, displayWithOdv } from '../../logic/odv'
import { assessmentLabel } from '../../logic/ruleDisplay'
import type { OrgDefinedValue } from '../../logic/selectionEntry'
import { targetHeading } from '../../logic/targetDisplay'
import { compareVersionsDescending } from '../../logic/versions'
import { termLabel } from '../../logic/vocabulary'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { Rule, RuleCheck, TargetCheck } from '../../types/library'
import { CodeBlock, OdvNote, SectionHeading, TargetHeading } from './CodeBlock'
import { DiscussionText } from './DiscussionText'
import { ScriptFile } from './ReferencedFile'

function CheckEntry({ label, check, odvValue }: { label: string; check: RuleCheck; odvValue: OrgDefinedValue | null }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      {check.shell_file !== undefined ? (
        <ScriptFile path={check.shell_file} odvValue={odvValue} />
      ) : check.shell ? (
        <CodeBlock code={check.shell} />
      ) : (
        <p className="text-xs text-slate-500">No check script.</p>
      )}
      {check.shell && containsOdvPlaceholder(check.shell) && <OdvNote odvValue={odvValue} />}
      {check.result && (
        <p className="text-xs text-slate-600">
          Expected result ({check.result.type}):{' '}
          <code className="rounded bg-slate-200 px-1 font-mono break-all">
            {displayWithOdv(String(check.result.value), odvValue)}
          </code>
        </p>
      )}
      {check.additional_info && <DiscussionText text={check.additional_info} format="asciidoc" odvValue={odvValue} />}
    </div>
  )
}

function TargetCheckBlock({ target, targetCheck, odvValue }: { target: string; targetCheck: TargetCheck; odvValue: OrgDefinedValue | null }) {
  const index = useVocabularyIndex()
  const versionChecks = Object.entries(targetCheck.by_version).sort(([left], [right]) => compareVersionsDescending(left, right))

  return (
    <div className="space-y-2" data-testid="check-target">
      <TargetHeading>{targetHeading(index, target, [targetCheck.language])}</TargetHeading>
      {targetCheck.default ? (
        <CheckEntry
          label={versionChecks.length > 0 ? 'Default check (versions without their own)' : 'Check (all listed versions)'}
          check={targetCheck.default}
          odvValue={odvValue}
        />
      ) : (
        <p className="text-xs text-slate-500">No default check; only the versions below have one.</p>
      )}
      {versionChecks.map(([version, check]) => (
        <CheckEntry key={version} label={termLabel(index, 'versions', versionKey(target, version))} check={check} odvValue={odvValue} />
      ))}
    </div>
  )
}

export function RuleCheckSection({ rule, odvValue, custom = false }: { rule: Rule; odvValue: OrgDefinedValue | null; custom?: boolean }) {
  const index = useVocabularyIndex()
  const targetChecks = Object.entries(rule.check ?? {})
  // An ISM control has no macOS entry at all, so only an mSCP rule that no
  // release lists is missing a version.
  const hasNoMacosVersion =
    rule.applicability.some((entry) => entry.target === GENERATED_TARGET) &&
    versionsForTarget(rule.applicability, GENERATED_TARGET).length === 0

  return (
    <div className="space-y-2">
      <SectionHeading custom={custom}>Check</SectionHeading>
      {hasNoMacosVersion && (
        <p className="text-xs text-amber-700">
          No macOS version listed: the source does not map this rule to any macOS release.
        </p>
      )}
      {rule.architecture && (
        <p className="text-xs text-slate-600">
          Applies to {rule.architecture} Macs only; other Macs report a pass.
        </p>
      )}
      {targetChecks.length === 0 ? (
        <p className="text-xs text-slate-500">
          No automated check. {assessmentLabel(rule.assessment, index).description}
        </p>
      ) : (
        targetChecks.map(([target, targetCheck]) => (
          <TargetCheckBlock key={target} target={target} targetCheck={targetCheck} odvValue={odvValue} />
        ))
      )}
    </div>
  )
}
