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
import { OdvCodeBlock, SectionHeading } from './CodeBlock'
import { DisclosureButtons, type DisclosureItem } from './DisclosureButtons'
import { DiscussionText } from './DiscussionText'
import { PayloadFile, ScriptFile } from './ReferencedFile'
import { TargetIcons } from './TargetIcons'

function StepEntry({
  label,
  step,
  odvValues,
  codeOdv,
}: {
  label: string
  step: RemediationStep
  odvValues: Partial<OdvValues>
  codeOdv: CodeOdvValues
}) {
  const highlightLanguage = scriptHighlightLanguage(step.language)
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-foreground/80">{label}</p>
      {step.shell_file !== undefined && (
        <ScriptFile path={step.shell_file} language={highlightLanguage} odvValues={odvValues} codeOdv={codeOdv} />
      )}
      {step.shell && <OdvCodeBlock code={step.shell} language={highlightLanguage} odvValues={odvValues} codeOdv={codeOdv} />}
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
  target,
  item,
  odvValues,
  codeOdv,
}: {
  target: string
  item: RemediationItem
  odvValues: Partial<OdvValues>
  codeOdv: CodeOdvValues
}) {
  const index = useVocabularyIndex()
  if (item.type === 'step') {
    return <StepEntry label={remediationStepLabel(index, target, item.step)} step={item.step} odvValues={odvValues} codeOdv={codeOdv} />
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
  const disclosureItems: DisclosureItem[] = Object.entries(rule.remediation ?? {}).flatMap(([target, targetRemediation]) =>
    remediationItemsOf(targetRemediation).map((item, position) => ({
      key: `${target}-${item.type}-${position}`,
      panelTestId: 'remediation-target',
      buttonContent: (
        <>
          <TargetIcons targetKeys={[target]} />
          {remediationItemButtonLabel(index, target, item)}
        </>
      ),
      panel: <RemediationItemPanel target={target} item={item} odvValues={odvValues} codeOdv={codeOdv} />,
    })),
  )

  if (!showsRemediationSection(rule)) return null

  return (
    <div className="space-y-2">
      <SectionHeading custom={custom}>Remediation</SectionHeading>
      {disclosureItems.length === 0 ? (
        <p className="text-xs text-muted-foreground">No remediation provided.</p>
      ) : (
        <DisclosureButtons items={disclosureItems} />
      )}
    </div>
  )
}
