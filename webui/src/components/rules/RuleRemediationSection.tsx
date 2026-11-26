import { INLINE_PAYLOAD_LANGUAGE, scriptHighlightLanguage } from '../../logic/codeLanguage'
import type { CodeOdvValues } from '../../logic/odv'
import type { OdvValues } from '../../logic/selectionEntry'
import {
  newestVersionsFirst,
  remediationItemButtonLabel,
  remediationPayloadLabel,
  remediationStepLabel,
  showsRemediationSection,
  type RemediationItem,
} from '../../logic/targetDisplay'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { RemediationStep, Rule, TargetRemediation } from '../../types/library'
import { CodeBlock, OdvCodeBlock } from './CodeBlock'
import { DiscussionText } from './DiscussionText'
import { PayloadFile, ScriptFile } from './ReferencedFile'
import { RegistryTable } from './RegistryTable'
import { ScriptTabs, type ScriptTabItem } from './ScriptTabs'
import { SectionCard } from './SectionCard'
import { TargetIcons } from './TargetIcons'

function StepEntry({
  label,
  step,
  ruleId,
  target,
  odvValues,
  codeOdv,
}: {
  label: string
  step: RemediationStep
  ruleId: string
  target: string
  odvValues: Partial<OdvValues>
  codeOdv: CodeOdvValues
}) {
  const highlightLanguage = scriptHighlightLanguage(step.language)
  // ansible and goss text is upstream's, shown as written: not scanned for ODV quoting, so never substituted.
  const isDisplayOnly = step.language === 'ansible' || step.language === 'goss'
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-foreground/80">{label}</p>
      {step.registry !== undefined && <RegistryTable settings={step.registry} odvValues={odvValues} ruleId={ruleId} target={target} purpose="fix" />}
      {step.shell_file !== undefined && (
        <ScriptFile path={step.shell_file} language={highlightLanguage} odvValues={odvValues} codeOdv={codeOdv} />
      )}
      {step.shell && isDisplayOnly && <CodeBlock code={step.shell} language={highlightLanguage} />}
      {step.shell && !isDisplayOnly && (
        <OdvCodeBlock code={step.shell} language={highlightLanguage} odvValues={odvValues} codeOdv={codeOdv} isVerifiedShell />
      )}
      {step.additional_info && <DiscussionText text={step.additional_info} format="asciidoc" odvValues={odvValues} codeOdv={codeOdv} />}
    </div>
  )
}

function JsonEntry({
  label,
  value,
  odvValues,
  codeOdv,
}: {
  label: string
  value: unknown
  odvValues: Partial<OdvValues>
  codeOdv: CodeOdvValues
}) {
  const json = JSON.stringify(value, null, 2)
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-foreground/80">{label}</p>
      <OdvCodeBlock code={json} language={INLINE_PAYLOAD_LANGUAGE} odvValues={odvValues} codeOdv={codeOdv} isJson />
    </div>
  )
}

function remediationItemsOf(targetRemediation: TargetRemediation): RemediationItem[] {
  return [
    ...newestVersionsFirst(targetRemediation.steps).map((step): RemediationItem => ({ type: 'step', step })),
    ...newestVersionsFirst(targetRemediation.payloads).map((payload): RemediationItem => ({ type: 'payload', payload })),
  ]
}

function RemediationItemPanel({
  ruleId,
  target,
  item,
  odvValues,
  codeOdv,
}: {
  ruleId: string
  target: string
  item: RemediationItem
  odvValues: Partial<OdvValues>
  codeOdv: CodeOdvValues
}) {
  const index = useVocabularyIndex()
  if (item.type === 'step') {
    return (
      <StepEntry
        label={remediationStepLabel(index, target, item.step)}
        step={item.step}
        ruleId={ruleId}
        target={target}
        odvValues={odvValues}
        codeOdv={codeOdv}
      />
    )
  }
  const label = remediationPayloadLabel(index, target, item.payload)
  return item.payload.data_file !== undefined ? (
    <PayloadFile label={label} path={item.payload.data_file} odvValues={odvValues} codeOdv={codeOdv} />
  ) : (
    <JsonEntry label={label} value={item.payload.data} odvValues={odvValues} codeOdv={codeOdv} />
  )
}

export function RuleRemediationSection({
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
  const scriptTabItems: ScriptTabItem[] = Object.entries(rule.remediation ?? {}).flatMap(([target, targetRemediation]) =>
    remediationItemsOf(targetRemediation).map((item, position) => ({
      key: `${target}-${item.type}-${position}`,
      panelTestId: 'remediation-target',
      tabContent: (
        <>
          <TargetIcons targetKeys={[target]} />
          {remediationItemButtonLabel(index, target, item)}
        </>
      ),
      panel: <RemediationItemPanel ruleId={rule.id} target={target} item={item} odvValues={odvValues} codeOdv={codeOdv} />,
    })),
  )

  if (!showsRemediationSection(rule)) return null

  return (
    <SectionCard title="Remediation" custom={custom}>
      {scriptTabItems.length === 0 ? (
        <p className="text-xs text-muted-foreground">No remediation provided.</p>
      ) : (
        <ScriptTabs ariaLabel="Remediation scripts" items={scriptTabItems} />
      )}
    </SectionCard>
  )
}
