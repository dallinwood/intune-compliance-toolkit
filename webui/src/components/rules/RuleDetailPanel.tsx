import { useRule, useStoredOdvValue } from '@/hooks/useRule'
import { odvSubstitutionMode, usableOdvValue } from '../../logic/odv'
import type { RuleRef } from '../../logic/selectionEntry'
import { useSelectionStore } from '../../state/selectionStore'
import type { Rule } from '../../types/library'
import { SectionHeading } from './CodeBlock'
import { DiscussionText } from './DiscussionText'
import { OrgDefinedValueInput } from './OrgDefinedValueInput'
import { RuleCheckSection } from './RuleCheckSection'
import { RuleReferences } from './RuleReferences'
import { RuleRemediationSection } from './RuleRemediationSection'

const PANEL_CLASS = 'border-t border-slate-100 bg-slate-50 p-4 text-sm'

export function RuleDetailPanel({ ruleRef }: { ruleRef: RuleRef }) {
  const ruleState = useRule(ruleRef)

  if (ruleState.status === 'loading') {
    return <p className={`${PANEL_CLASS} text-slate-500`}>Loading details…</p>
  }
  if (ruleState.status === 'error') {
    return <p className={`${PANEL_CLASS} text-red-600`}>Failed to load: {ruleState.message}</p>
  }
  return <LoadedRuleDetail ruleRef={ruleRef} rule={ruleState.rule} />
}

function LoadedRuleDetail({ ruleRef, rule }: { ruleRef: RuleRef; rule: Rule }) {
  const storedValue = useStoredOdvValue(ruleRef)
  const setOdvValue = useSelectionStore((store) => store.setOdvValue)
  const clearOdvValue = useSelectionStore((store) => store.clearOdvValue)
  const mode = odvSubstitutionMode(rule)
  const odvValue = usableOdvValue(rule.odv, mode, storedValue, rule.id)
  const { source } = rule

  return (
    <div className={`space-y-4 ${PANEL_CLASS}`}>
      <DiscussionText text={rule.discussion} odvValue={odvValue} />

      {rule.odv && (
        <div className="space-y-1">
          <SectionHeading>Organization-defined value</SectionHeading>
          <OrgDefinedValueInput
            ruleId={rule.id}
            odv={rule.odv}
            mode={mode}
            storedValue={storedValue}
            onCommit={(value) => setOdvValue(ruleRef, value)}
            onClear={() => clearOdvValue(ruleRef)}
          />
        </div>
      )}

      <RuleCheckSection rule={rule} odvValue={odvValue} />
      <RuleRemediationSection rule={rule} odvValue={odvValue} />
      <RuleReferences references={rule.references} />

      <p className="text-xs text-slate-500">
        From{' '}
        <a className="text-blue-600 underline" href={source.upstream_url} target="_blank" rel="noreferrer">
          NIST mSCP {source.release_tag}
        </a>{' '}
        ({source.upstream_rule_id}), licensed{' '}
        <a className="text-blue-600 underline" href={source.license.url} target="_blank" rel="noreferrer">
          {source.license.name}
        </a>
        , modified for this tool.
      </p>
    </div>
  )
}
