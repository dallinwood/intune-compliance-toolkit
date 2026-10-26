import { versionKey, versionsForTarget } from '../../logic/applicability'
import { GENERATED_TARGET } from '../../logic/checkPlan'
import { displayWithOdv, type CodeOdvValues } from '../../logic/odv'
import { scriptHighlightLanguage } from '../../logic/codeLanguage'
import { assessmentLabel } from '../../logic/ruleDisplay'
import type { OrgDefinedValue } from '../../logic/selectionEntry'
import { targetHeading } from '../../logic/targetDisplay'
import { compareVersionsDescending } from '../../logic/versions'
import { termLabel } from '../../logic/vocabulary'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { Rule, RuleCheck, ScriptLanguage, TargetCheck } from '../../types/library'
import { OdvCodeBlock, SectionHeading, TargetHeading } from './CodeBlock'
import { DiscussionText } from './DiscussionText'
import { ScriptFile } from './ReferencedFile'

function CheckEntry({
  label,
  check,
  language,
  odvValue,
  codeOdv,
}: {
  label: string
  check: RuleCheck
  language: ScriptLanguage
  odvValue: OrgDefinedValue | null
  codeOdv: CodeOdvValues
}) {
  const highlightLanguage = scriptHighlightLanguage(language)
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-foreground/80">{label}</p>
      {check.shell_file !== undefined ? (
        <ScriptFile path={check.shell_file} language={highlightLanguage} odvValue={odvValue} codeOdv={codeOdv} />
      ) : check.shell ? (
        <OdvCodeBlock code={check.shell} language={highlightLanguage} odvValue={odvValue} codeOdv={codeOdv} />
      ) : (
        <p className="text-xs text-muted-foreground">No check script.</p>
      )}
      {check.result && (
        <p className="text-xs text-foreground/80">
          Expected result ({check.result.type}):{' '}
          <code className="rounded bg-foreground/10 px-1 font-mono break-all">
            {displayWithOdv(String(check.result.value), odvValue)}
          </code>
        </p>
      )}
      {check.additional_info && <DiscussionText text={check.additional_info} format="asciidoc" odvValue={odvValue} codeOdv={codeOdv} />}
    </div>
  )
}

function TargetCheckBlock({
  target,
  targetCheck,
  odvValue,
  codeOdv,
}: {
  target: string
  targetCheck: TargetCheck
  odvValue: OrgDefinedValue | null
  codeOdv: CodeOdvValues
}) {
  const index = useVocabularyIndex()
  const versionChecks = Object.entries(targetCheck.by_version).sort(([left], [right]) => compareVersionsDescending(left, right))

  return (
    <div className="space-y-2" data-testid="check-target">
      <TargetHeading>{targetHeading(index, target, [targetCheck.language])}</TargetHeading>
      {targetCheck.default ? (
        <CheckEntry
          label={versionChecks.length > 0 ? 'Default check (versions without their own)' : 'Check (all listed versions)'}
          check={targetCheck.default}
          language={targetCheck.language}
          odvValue={odvValue}
          codeOdv={codeOdv}
        />
      ) : (
        <p className="text-xs text-muted-foreground">No default check; only the versions below have one.</p>
      )}
      {versionChecks.map(([version, check]) => (
        <CheckEntry
          key={version}
          label={termLabel(index, 'versions', versionKey(target, version))}
          check={check}
          language={targetCheck.language}
          odvValue={odvValue}
          codeOdv={codeOdv}
        />
      ))}
    </div>
  )
}

export function RuleCheckSection({
  rule,
  odvValue,
  codeOdv,
  custom = false,
}: {
  rule: Rule
  odvValue: OrgDefinedValue | null
  codeOdv: CodeOdvValues
  custom?: boolean
}) {
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
        <p className="text-xs text-warning-foreground">
          No macOS version listed: the source does not map this rule to any macOS release.
        </p>
      )}
      {rule.architecture && (
        <p className="text-xs text-foreground/80">
          Applies to {rule.architecture} Macs only; other Macs report a pass.
        </p>
      )}
      {targetChecks.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No automated check. {assessmentLabel(rule.assessment, index).description}
        </p>
      ) : (
        targetChecks.map(([target, targetCheck]) => (
          <TargetCheckBlock
            key={target}
            target={target}
            targetCheck={targetCheck}
            odvValue={odvValue}
            codeOdv={codeOdv}
          />
        ))
      )}
    </div>
  )
}
