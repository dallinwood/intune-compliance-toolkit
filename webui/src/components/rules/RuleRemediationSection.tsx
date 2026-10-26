import { containsOdvPlaceholder } from '../../logic/odv'
import type { OrgDefinedValue } from '../../logic/selectionEntry'
import { remediationPayloadLabel, remediationStepLabel, showsRemediationSection, targetHeading } from '../../logic/targetDisplay'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { RemediationStep, Rule, TargetRemediation } from '../../types/library'
import { CodeBlock, OdvNote, SectionHeading, TargetHeading } from './CodeBlock'
import { DiscussionText } from './DiscussionText'

function StepEntry({ label, step, odvValue }: { label: string; step: RemediationStep; odvValue: OrgDefinedValue | null }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      {step.shell && <CodeBlock code={step.shell} />}
      {step.shell && containsOdvPlaceholder(step.shell) && <OdvNote odvValue={odvValue} />}
      {step.additional_info && <DiscussionText text={step.additional_info} format="asciidoc" odvValue={odvValue} />}
    </div>
  )
}

// Payloads are shown exactly as mSCP ships them, $ODV included; the note
// explains the placeholder instead of substituting into the JSON.
function JsonEntry({ label, value, odvValue }: { label: string; value: unknown; odvValue: OrgDefinedValue | null }) {
  const json = JSON.stringify(value, null, 2)
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <CodeBlock code={json} />
      {containsOdvPlaceholder(json) && <OdvNote odvValue={odvValue} />}
    </div>
  )
}

function TargetRemediationBlock({
  target,
  targetRemediation,
  odvValue,
}: {
  target: string
  targetRemediation: TargetRemediation
  odvValue: OrgDefinedValue | null
}) {
  const index = useVocabularyIndex()
  const { steps, payloads } = targetRemediation
  const languages = steps.map((step) => step.language)

  return (
    <div className="space-y-2" data-testid="remediation-target">
      <TargetHeading>{targetHeading(index, target, languages)}</TargetHeading>
      {steps.length === 0 && payloads.length === 0 && <p className="text-xs text-slate-500">No remediation provided.</p>}
      {steps.map((step, position) => (
        <StepEntry key={`step-${position}`} label={remediationStepLabel(index, target, step)} step={step} odvValue={odvValue} />
      ))}
      {payloads.map((payload, position) => (
        <JsonEntry
          key={`payload-${position}`}
          label={remediationPayloadLabel(index, target, payload)}
          value={payload.data}
          odvValue={odvValue}
        />
      ))}
    </div>
  )
}

export function RuleRemediationSection({
  rule,
  odvValue,
  custom = false,
}: {
  rule: Rule
  odvValue: OrgDefinedValue | null
  custom?: boolean
}) {
  if (!showsRemediationSection(rule)) return null
  const targetRemediations = Object.entries(rule.remediation ?? {})

  return (
    <div className="space-y-2">
      <SectionHeading custom={custom}>Remediation</SectionHeading>
      {targetRemediations.length === 0 && <p className="text-xs text-slate-500">No remediation provided.</p>}
      {targetRemediations.map(([target, targetRemediation]) => (
        <TargetRemediationBlock key={target} target={target} targetRemediation={targetRemediation} odvValue={odvValue} />
      ))}
    </div>
  )
}
