import { useState } from 'react'
import { versionKey, versionsForTarget } from '../../logic/applicability'
import { GENERATED_TARGET } from '../../logic/checkPlan'
import { displayWithOdv, type CodeOdvValues } from '../../logic/odv'
import { scriptHighlightLanguage } from '../../logic/codeLanguage'
import { assessmentLabel } from '../../logic/ruleDisplay'
import type { OrgDefinedValue } from '../../logic/selectionEntry'
import { scriptLanguageLabel } from '../../logic/targetDisplay'
import { compareVersionsDescending } from '../../logic/versions'
import { termLabel } from '../../logic/vocabulary'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { Rule, RuleCheck, ScriptLanguage, TargetCheck } from '../../types/library'
import { OdvCodeBlock, SectionHeading } from './CodeBlock'
import { DisclosureButtons, SelectionButtons, type SelectionItem } from './DisclosureButtons'
import { DiscussionText } from './DiscussionText'
import { ScriptFile } from './ReferencedFile'
import { TargetIcons } from './TargetIcons'

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

const DEFAULT_CHECK_KEY = 'default'

function versionCheckKey(version: string): string {
  return `version-${version}`
}

function TargetCheckPanel({
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
  const [selectedKey, setSelectedKey] = useState(DEFAULT_CHECK_KEY)
  const versionChecks = Object.entries(targetCheck.by_version).sort(([left], [right]) => compareVersionsDescending(left, right))
  const selectedVersionCheck = versionChecks.find(([version]) => versionCheckKey(version) === selectedKey)

  if (versionChecks.length === 0) {
    return targetCheck.default ? (
      <CheckEntry
        label="Check (all listed versions)"
        check={targetCheck.default}
        language={targetCheck.language}
        odvValue={odvValue}
        codeOdv={codeOdv}
      />
    ) : (
      <p className="text-xs text-muted-foreground">No check provided.</p>
    )
  }

  const versionItems: SelectionItem[] = [
    { key: DEFAULT_CHECK_KEY, label: 'Default' },
    ...versionChecks.map(([version]) => ({ key: versionCheckKey(version), label: termLabel(index, 'versions', versionKey(target, version)) })),
  ]

  return (
    <div className="space-y-2">
      <SelectionButtons items={versionItems} selectedKey={selectedKey} onSelect={setSelectedKey} ariaLabel="Check versions" />
      {selectedVersionCheck ? (
        <CheckEntry
          label={termLabel(index, 'versions', versionKey(target, selectedVersionCheck[0]))}
          check={selectedVersionCheck[1]}
          language={targetCheck.language}
          odvValue={odvValue}
          codeOdv={codeOdv}
        />
      ) : targetCheck.default ? (
        <CheckEntry
          label="Default check (versions without their own)"
          check={targetCheck.default}
          language={targetCheck.language}
          odvValue={odvValue}
          codeOdv={codeOdv}
        />
      ) : (
        <p className="text-xs text-muted-foreground">No default check; only the listed versions have one.</p>
      )}
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
        <DisclosureButtons
          items={targetChecks.map(([target, targetCheck]) => ({
            key: target,
            panelTestId: 'check-target',
            buttonContent: (
              <>
                <TargetIcons targetKeys={[target]} />
                {scriptLanguageLabel(targetCheck.language)}
              </>
            ),
            panel: <TargetCheckPanel target={target} targetCheck={targetCheck} odvValue={odvValue} codeOdv={codeOdv} />,
          }))}
        />
      )}
    </div>
  )
}
