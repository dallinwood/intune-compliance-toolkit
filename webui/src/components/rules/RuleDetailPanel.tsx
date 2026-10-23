import { useRule, useStoredOdvValue } from '@/hooks/useRule'
import { odvSubstitutionMode, usableOdvValue, validateOdvValue } from '../../logic/odv'
import type { RuleRef } from '../../logic/selectionEntry'
import { useSelectionStore } from '../../state/selectionStore'
import type { Rule, RuleSource } from '../../types/library'
import { SectionHeading } from './CodeBlock'
import { DiscussionText } from './DiscussionText'
import { OrgDefinedValueInput } from './OrgDefinedValueInput'
import { RuleCheckSection } from './RuleCheckSection'
import { RuleReferences } from './RuleReferences'
import { RuleRemediationSection } from './RuleRemediationSection'

const PANEL_CLASS = 'border-t border-slate-100 bg-slate-50 p-4 text-sm'
const BREADCRUMB_SEPARATOR = ' › '

// Only the parts the source provides: mSCP rules have neither, an ISM control
// has both.
function revisionLine(source: RuleSource): string | null {
  const parts = [
    source.upstream_revision !== null ? `Revision ${source.upstream_revision}` : null,
    source.upstream_updated !== null ? `updated ${source.upstream_updated}` : null,
  ].filter((part) => part !== null)
  return parts.length > 0 ? parts.join(', ') : null
}

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
  // An invalid saved value blocks generation, so the details show the
  // placeholder rather than a recommended value that will not be used.
  const storedValueIsInvalid =
    rule.odv !== null && storedValue !== null && validateOdvValue(rule.odv, storedValue, mode, rule.id) !== null
  const odvValue = storedValueIsInvalid ? null : usableOdvValue(rule.odv, mode, storedValue, rule.id)
  const { source } = rule
  const revision = revisionLine(source)

  return (
    <div className={`space-y-4 ${PANEL_CLASS}`}>
      <div className="space-y-0.5 text-xs text-slate-500">
        <p className="break-words">{rule.section_path.join(BREADCRUMB_SEPARATOR)}</p>
        {revision && <p>{revision}</p>}
      </div>

      <DiscussionText text={rule.discussion} format={rule.discussion_format} odvValue={odvValue} />

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
