import { versionKey, versionsForTarget } from '../../logic/applicability'
import { GENERATED_TARGET } from '../../logic/checkPlan'
import { containsOdvPlaceholder, displayWithOdv } from '../../logic/odv'
import { assessmentLabel } from '../../logic/ruleDisplay'
import type { OrgDefinedValue } from '../../logic/selectionEntry'
import { compareVersionsDescending } from '../../logic/versions'
import { termLabel } from '../../logic/vocabulary'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { Rule, RuleCheck } from '../../types/library'
import { CodeBlock, OdvNote, SectionHeading } from './CodeBlock'
import { DiscussionText } from './DiscussionText'

function CheckEntry({ label, check, odvValue }: { label: string; check: RuleCheck; odvValue: OrgDefinedValue | null }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      {check.shell ? <CodeBlock code={check.shell} /> : <p className="text-xs text-slate-500">No check script.</p>}
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

export function RuleCheckSection({ rule, odvValue, custom = false }: { rule: Rule; odvValue: OrgDefinedValue | null; custom?: boolean }) {
  const index = useVocabularyIndex()
  const versionChecks = Object.entries(rule.check?.by_version ?? {}).sort(([left], [right]) =>
    compareVersionsDescending(left, right),
  )
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
      {!rule.check ? (
        <p className="text-xs text-slate-500">
          No automated check. {assessmentLabel(rule.assessment, index).description}
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
            <CheckEntry key={version} label={termLabel(index, 'versions', versionKey(GENERATED_TARGET, version))} check={check} odvValue={odvValue} />
          ))}
        </>
      )}
    </div>
  )
}
