import { useState } from 'react'
import { versionKey, versionsForTarget } from '../../logic/applicability'
import { GENERATED_TARGET } from '../../logic/checkPlan'
import { displayWithOdvs, type CodeOdvValues } from '../../logic/odv'
import { scriptHighlightLanguage } from '../../logic/codeLanguage'
import { assessmentLabel } from '../../logic/ruleDisplay'
import type { OdvValues } from '../../logic/selectionEntry'
import { scriptLanguageLabel } from '../../logic/targetDisplay'
import { compareVersionsDescending } from '../../logic/versions'
import { termLabel } from '../../logic/vocabulary'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { Rule, RuleCheck, ScriptLanguage, CheckItem } from '../../types/library'
import { CodeBlock, OdvCodeBlock, SectionHeading } from './CodeBlock'
import { DisclosureButtons, SelectionButtons, type SelectionItem } from './DisclosureButtons'
import { DiscussionText } from './DiscussionText'
import { ScriptFile } from './ReferencedFile'
import { RegistryTable } from './RegistryTable'
import { TargetIcons } from './TargetIcons'

function CheckEntry({
  label,
  check,
  language,
  ruleId,
  target,
  odvValues,
  codeOdv,
}: {
  label: string
  check: RuleCheck
  language: ScriptLanguage
  ruleId: string
  target: string
  odvValues: Partial<OdvValues>
  codeOdv: CodeOdvValues
}) {
  const highlightLanguage = scriptHighlightLanguage(language)
  const isInstructions = language === 'instructions'
  // ansible and goss text is upstream's, shown as written: not scanned for ODV quoting, so never substituted.
  const isDisplayOnly = language === 'ansible' || language === 'goss'
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-foreground/80">{label}</p>
      {check.registry !== undefined ? (
        <RegistryTable settings={check.registry} odvValues={odvValues} ruleId={ruleId} target={target} purpose="check" />
      ) : check.shell_file !== undefined ? (
        <ScriptFile path={check.shell_file} language={highlightLanguage} odvValues={odvValues} codeOdv={codeOdv} />
      ) : check.shell && isDisplayOnly ? (
        <CodeBlock code={check.shell} language={highlightLanguage} />
      ) : check.shell ? (
        <OdvCodeBlock code={check.shell} language={highlightLanguage} odvValues={odvValues} codeOdv={codeOdv} isVerifiedShell />
      ) : isInstructions ? null : (
        <p className="text-xs text-muted-foreground">No check script.</p>
      )}
      {check.result && (
        <p className="text-xs text-foreground/80">
          Expected result ({check.result.type}):{' '}
          <code className="rounded bg-foreground/10 px-1 font-mono break-all">
            {displayWithOdvs(String(check.result.value), odvValues)}
          </code>
        </p>
      )}
      {check.additional_info && <DiscussionText text={check.additional_info} format="asciidoc" odvValues={odvValues} codeOdv={codeOdv} />}
    </div>
  )
}

const DEFAULT_CHECK_KEY = 'default'

function versionCheckKey(version: string): string {
  return `version-${version}`
}

function CheckItemPanel({
  ruleId,
  target,
  checkItem,
  odvValues,
  codeOdv,
}: {
  ruleId: string
  target: string
  checkItem: CheckItem
  odvValues: Partial<OdvValues>
  codeOdv: CodeOdvValues
}) {
  const index = useVocabularyIndex()
  const [selectedKey, setSelectedKey] = useState(DEFAULT_CHECK_KEY)
  const versionChecks = Object.entries(checkItem.by_version).sort(([left], [right]) => compareVersionsDescending(left, right))
  const selectedVersionCheck = versionChecks.find(([version]) => versionCheckKey(version) === selectedKey)

  if (versionChecks.length === 0) {
    return checkItem.default ? (
      <CheckEntry
        label="Check (all listed versions)"
        check={checkItem.default}
        language={checkItem.language}
        ruleId={ruleId}
        target={target}
        odvValues={odvValues}
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
          language={checkItem.language}
          ruleId={ruleId}
          target={target}
          odvValues={odvValues}
          codeOdv={codeOdv}
        />
      ) : checkItem.default ? (
        <CheckEntry
          label="Default check (versions without their own)"
          check={checkItem.default}
          language={checkItem.language}
          ruleId={ruleId}
          target={target}
          odvValues={odvValues}
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
  odvValues,
  codeOdv,
  custom = false,
}: {
  rule: Rule
  odvValues: Partial<OdvValues>
  codeOdv: CodeOdvValues
  custom?: boolean
}) {
  const index = useVocabularyIndex()
  const checkItemsByTarget = Object.entries(rule.check ?? {})
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
      {checkItemsByTarget.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No automated check. {assessmentLabel(rule.assessment, index).description}
        </p>
      ) : (
        <DisclosureButtons
          items={checkItemsByTarget.flatMap(([target, checkItems]) =>
            checkItems.map((checkItem, position) => ({
              key: `${target}-${position}`,
              panelTestId: 'check-target',
              buttonContent: (
                <>
                  <TargetIcons targetKeys={[target]} />
                  {checkItem.name ?? scriptLanguageLabel(checkItem.language)}
                </>
              ),
              panel: <CheckItemPanel ruleId={rule.id} target={target} checkItem={checkItem} odvValues={odvValues} codeOdv={codeOdv} />,
            })),
          )}
        />
      )}
    </div>
  )
}
