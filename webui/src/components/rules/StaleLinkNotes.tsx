import { KIND_LABELS } from '../../logic/changeLabels'
import type { MappedRule } from '../../logic/mappingIndex'
import { staleEndpoints } from '../../logic/mappingIndex'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { termLabel } from '../../logic/vocabulary'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { RuleRow } from '../../types/rule-row'

// link is the index entry as seen from fromRow, so changedKinds belongs to toRow and selfChangedKinds to fromRow.
export function StaleLinkNotes({ link, fromRow, toRow }: { link: MappedRule; fromRow: RuleRow; toRow: RuleRow }) {
  const vocabularyIndex = useVocabularyIndex()
  const stale = staleEndpoints(
    link,
    { ruleId: fromRow.ref.id, sourceName: fromRow.sourceName, releaseTag: fromRow.releaseTag },
    { sourceName: toRow.sourceName, releaseTag: toRow.releaseTag },
    (ruleId) => (ruleId === link.rule ? link.changedKinds : link.selfChangedKinds) ?? null,
  )
  return (
    <>
      {stale.map((endpoint) => (
        <p key={endpoint.ruleId} data-testid="stale-mapping-note" className="text-warning-foreground">
          {endpoint.changedKinds === null ? (
            <>
              This link was checked against {termLabel(vocabularyIndex, 'sources', endpoint.sourceName)} {endpoint.mappedRelease} for{' '}
              {upstreamRuleId(endpoint.ruleId)}, which is now from {endpoint.currentRelease}. Review it for accuracy.
            </>
          ) : (
            <>
              Mapped against {endpoint.mappedRelease}; {upstreamRuleId(endpoint.ruleId)} has changed since (
              {endpoint.changedKinds.map((kind) => KIND_LABELS[kind]).join(', ')}). Review the link.
            </>
          )}
        </p>
      ))}
    </>
  )
}
