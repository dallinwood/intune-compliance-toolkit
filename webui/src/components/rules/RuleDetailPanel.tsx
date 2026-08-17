import { useEffect, useState } from 'react'
import { fetchRuleDetail } from '../../data/ruleDetail'
import { getSelection, type RuleRef } from '../../logic/selectionEntry'
import { useSelectionStore } from '../../state/selectionStore'
import type { RuleDetail } from '../../types/rule-detail'
import { AuditMethodPicker } from './AuditMethodPicker'
import { OrgDefinedValueInput } from './OrgDefinedValueInput'
import { RemediationMethodPicker } from './RemediationMethodPicker'

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; rule: RuleDetail }

export function RuleDetailPanel({ ruleRef }: { ruleRef: RuleRef }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const selections = useSelectionStore((store) => store.selections)
  const setAuditMethodIndex = useSelectionStore((store) => store.setAuditMethodIndex)
  const setRemediationMethodIndex = useSelectionStore((store) => store.setRemediationMethodIndex)
  const setOrganizationDefinedValue = useSelectionStore((store) => store.setOrganizationDefinedValue)

  useEffect(() => {
    let cancelled = false
    fetchRuleDetail(ruleRef)
      .then((rule) => {
        if (!cancelled) setState({ status: 'ready', rule })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      cancelled = true
    }
  }, [ruleRef.family, ruleRef.product, ruleRef.version, ruleRef.file])

  if (state.status === 'loading') {
    return <p className="border-t border-slate-100 bg-slate-50 p-4 text-sm text-slate-500">Loading details…</p>
  }
  if (state.status === 'error') {
    return <p className="border-t border-slate-100 bg-slate-50 p-4 text-sm text-red-600">Failed to load: {state.message}</p>
  }

  const { rule } = state
  const selection = getSelection(selections, ruleRef)
  const auditMethod = rule.audit.methods[selection.selectedAuditMethodIndex]
  const organizationDefinedChecks = (auditMethod?.steps ?? []).flatMap((step) =>
    step.output_check.filter((check) => check.value_source === 'organization_defined'),
  )

  return (
    <div className="space-y-3 border-t border-slate-100 bg-slate-50 p-4 text-sm">
      <p className="text-slate-700">{rule.description}</p>

      <div>
        <h5 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Rationale</h5>
        <p className="text-slate-600">{rule.rationale}</p>
      </div>

      <AuditMethodPicker
        methods={rule.audit.methods}
        selectedIndex={selection.selectedAuditMethodIndex}
        onChange={(index) => setAuditMethodIndex(ruleRef, index)}
      />

      {auditMethod?.type === 'scripted' && (
        <div className="space-y-2">
          {(auditMethod.steps ?? []).map((step, stepIndex) => (
            <div key={stepIndex} className="rounded border border-slate-200 bg-white p-2">
              {!step.check_command_verified && (
                <p className="mb-1 text-xs font-medium text-amber-600">⚠ Unverified check command</p>
              )}
              <pre className="overflow-x-auto text-xs whitespace-pre-wrap text-slate-700">{step.check_command}</pre>
            </div>
          ))}
        </div>
      )}

      {organizationDefinedChecks.length > 0 && (
        <div className="space-y-1">
          <h5 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Organization-defined values</h5>
          {organizationDefinedChecks.map((check) => (
            <OrgDefinedValueInput
              key={check.variable}
              check={check}
              value={selection.organizationDefinedValues[check.variable]}
              onChange={(value) => setOrganizationDefinedValue(ruleRef, check.variable, value)}
            />
          ))}
        </div>
      )}

      <RemediationMethodPicker
        methods={rule.remediation.methods}
        selectedIndex={selection.selectedRemediationMethodIndex}
        onChange={(index) => setRemediationMethodIndex(ruleRef, index)}
      />

      {rule.references.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">References</h5>
          <ul className="list-disc pl-5">
            {rule.references.map((url) => (
              <li key={url}>
                <a className="text-blue-600 underline" href={url} target="_blank" rel="noreferrer">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
