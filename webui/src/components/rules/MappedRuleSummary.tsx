import { useDisplayTitle } from '../../hooks/useDisplayTitle'
import { useRule, useUsableOdvValue } from '../../hooks/useRule'
import { displayWithOdv } from '../../logic/odv'
import { discussionExcerpt } from '../../logic/mappedRuleView'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { termLabel } from '../../logic/vocabulary'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { RuleRow } from '../../types/rule-row'
import { AssessmentBadge } from './RuleRowCells'
import { TargetIcons } from './TargetIcons'

const EXCERPT_CHARACTERS = 140

function yesOrNo(present: boolean): string {
  return present ? 'yes' : 'no'
}

// Tooltip content, so it mounts (and loads the rule) only while the summary is open.
export function MappedRuleSummary({ row }: { row: RuleRow }) {
  const vocabularyIndex = useVocabularyIndex()
  const title = useDisplayTitle(row)
  const ruleState = useRule(row.ref)
  const odvValue = useUsableOdvValue(ruleState.status === 'ready' ? ruleState.rule : null, row.ref)

  return (
    <div className="flex w-72 max-w-full flex-col gap-1.5 break-words whitespace-normal">
      <p className="font-mono break-all text-muted-foreground">
        {termLabel(vocabularyIndex, 'sources', row.sourceName)} {upstreamRuleId(row.ref.id)}
      </p>
      <p className="text-sm font-medium">{title}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <TargetIcons targetKeys={row.targetKeys} />
        <AssessmentBadge row={row} />
      </div>
      {ruleState.status === 'loading' && <p className="text-muted-foreground">Loading…</p>}
      {ruleState.status === 'error' && <p className="text-destructive">Details could not be loaded.</p>}
      {ruleState.status === 'ready' && (
        <>
          <p className="flex gap-3">
            <span>Check: {yesOrNo(ruleState.rule.check !== null)}</span>
            <span>Fix: {yesOrNo(ruleState.rule.remediation !== null)}</span>
          </p>
          <p>{discussionExcerpt(displayWithOdv(ruleState.rule.discussion, odvValue), EXCERPT_CHARACTERS)}</p>
        </>
      )}
    </div>
  )
}
