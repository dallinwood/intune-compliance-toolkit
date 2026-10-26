import { INLINE_PAYLOAD_LANGUAGE, scriptHighlightLanguage } from '../../logic/codeLanguage'
import type { CodeOdvValues } from '../../logic/odv'
import type { OrgDefinedValue } from '../../logic/selectionEntry'
import {
  newestVersionsFirst,
  remediationPayloadLabel,
  remediationStepLabel,
  showsRemediationSection,
  targetHeading,
} from '../../logic/targetDisplay'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { RemediationStep, Rule, TargetRemediation } from '../../types/library'
import { OdvCodeBlock, SectionHeading, TargetHeading } from './CodeBlock'
import { DiscussionText } from './DiscussionText'
import { PayloadFile, ScriptFile } from './ReferencedFile'

function StepEntry({
  label,
  step,
  odvValue,
  codeOdv,
}: {
  label: string
  step: RemediationStep
  odvValue: OrgDefinedValue | null
  codeOdv: CodeOdvValues
}) {
  const highlightLanguage = scriptHighlightLanguage(step.language)
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      {step.shell_file !== undefined && (
        <ScriptFile path={step.shell_file} language={highlightLanguage} odvValue={odvValue} codeOdv={codeOdv} />
      )}
      {step.shell && <OdvCodeBlock code={step.shell} language={highlightLanguage} odvValue={odvValue} codeOdv={codeOdv} />}
      {step.additional_info && <DiscussionText text={step.additional_info} format="asciidoc" odvValue={odvValue} codeOdv={codeOdv} />}
    </div>
  )
}

function JsonEntry({
  label,
  value,
  odvValue,
  codeOdv,
}: {
  label: string
  value: unknown
  odvValue: OrgDefinedValue | null
  codeOdv: CodeOdvValues
}) {
  const json = JSON.stringify(value, null, 2)
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <OdvCodeBlock code={json} language={INLINE_PAYLOAD_LANGUAGE} odvValue={odvValue} codeOdv={codeOdv} isJson />
    </div>
  )
}

function TargetRemediationBlock({
  target,
  targetRemediation,
  odvValue,
  codeOdv,
}: {
  target: string
  targetRemediation: TargetRemediation
  odvValue: OrgDefinedValue | null
  codeOdv: CodeOdvValues
}) {
  const index = useVocabularyIndex()
  const steps = newestVersionsFirst(targetRemediation.steps)
  const payloads = newestVersionsFirst(targetRemediation.payloads)
  const languages = steps.map((step) => step.language)

  return (
    <div className="space-y-2" data-testid="remediation-target">
      <TargetHeading>{targetHeading(index, target, languages)}</TargetHeading>
      {steps.length === 0 && payloads.length === 0 && <p className="text-xs text-slate-500">No remediation provided.</p>}
      {steps.map((step, position) => (
        <StepEntry key={`step-${position}`} label={remediationStepLabel(index, target, step)}
          step={step}
          odvValue={odvValue}
          codeOdv={codeOdv}
        />
      ))}
      {payloads.map((payload, position) =>
        payload.data_file !== undefined ? (
          <PayloadFile
            key={`payload-${position}`}
            label={remediationPayloadLabel(index, target, payload)}
            path={payload.data_file}
            odvValue={odvValue}
            codeOdv={codeOdv}
          />
        ) : (
          <JsonEntry
            key={`payload-${position}`}
            label={remediationPayloadLabel(index, target, payload)}
            value={payload.data}
            odvValue={odvValue}
            codeOdv={codeOdv}
          />
        ),
      )}
    </div>
  )
}

export function RuleRemediationSection({
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
  if (!showsRemediationSection(rule)) return null
  const targetRemediations = Object.entries(rule.remediation ?? {})

  return (
    <div className="space-y-2">
      <SectionHeading custom={custom}>Remediation</SectionHeading>
      {targetRemediations.length === 0 && <p className="text-xs text-slate-500">No remediation provided.</p>}
      {targetRemediations.map(([target, targetRemediation]) => (
        <TargetRemediationBlock
          key={target}
          target={target}
          targetRemediation={targetRemediation}
          odvValue={odvValue}
          codeOdv={codeOdv}
        />
      ))}
    </div>
  )
}
