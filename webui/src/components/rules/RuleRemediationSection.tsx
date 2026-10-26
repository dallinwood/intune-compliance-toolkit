import { INLINE_PAYLOAD_LANGUAGE, scriptHighlightLanguage } from '../../logic/codeLanguage'
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
  codeOdvValue,
}: {
  label: string
  step: RemediationStep
  odvValue: OrgDefinedValue | null
  codeOdvValue: OrgDefinedValue | null
}) {
  const highlightLanguage = scriptHighlightLanguage(step.language)
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      {step.shell_file !== undefined && (
        <ScriptFile path={step.shell_file} language={highlightLanguage} odvValue={odvValue} codeOdvValue={codeOdvValue} />
      )}
      {step.shell && <OdvCodeBlock code={step.shell} language={highlightLanguage} odvValue={odvValue} codeOdvValue={codeOdvValue} />}
      {step.additional_info && <DiscussionText text={step.additional_info} format="asciidoc" odvValue={odvValue} />}
    </div>
  )
}

function JsonEntry({
  label,
  value,
  odvValue,
  codeOdvValue,
}: {
  label: string
  value: unknown
  odvValue: OrgDefinedValue | null
  codeOdvValue: OrgDefinedValue | null
}) {
  const json = JSON.stringify(value, null, 2)
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <OdvCodeBlock code={json} language={INLINE_PAYLOAD_LANGUAGE} odvValue={odvValue} codeOdvValue={codeOdvValue} isJson />
    </div>
  )
}

function TargetRemediationBlock({
  target,
  targetRemediation,
  odvValue,
  codeOdvValue,
}: {
  target: string
  targetRemediation: TargetRemediation
  odvValue: OrgDefinedValue | null
  codeOdvValue: OrgDefinedValue | null
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
          codeOdvValue={codeOdvValue}
        />
      ))}
      {payloads.map((payload, position) =>
        payload.data_file !== undefined ? (
          <PayloadFile
            key={`payload-${position}`}
            label={remediationPayloadLabel(index, target, payload)}
            path={payload.data_file}
            odvValue={odvValue}
            codeOdvValue={codeOdvValue}
          />
        ) : (
          <JsonEntry
            key={`payload-${position}`}
            label={remediationPayloadLabel(index, target, payload)}
            value={payload.data}
            odvValue={odvValue}
            codeOdvValue={codeOdvValue}
          />
        ),
      )}
    </div>
  )
}

export function RuleRemediationSection({
  rule,
  odvValue,
  codeOdvValue,
  custom = false,
}: {
  rule: Rule
  odvValue: OrgDefinedValue | null
  codeOdvValue: OrgDefinedValue | null
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
          codeOdvValue={codeOdvValue}
        />
      ))}
    </div>
  )
}
