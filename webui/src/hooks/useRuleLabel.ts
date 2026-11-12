import { upstreamRuleId } from '../logic/ruleDisplay'
import { termLabel } from '../logic/vocabulary'
import { useRuleMappings } from '../state/mappingsContext'
import { useVocabularyIndex } from '../state/vocabularyContext'

// "ASD ISM ISM-1584": the source's label and the rule's upstream id, for sentences about a link.
export function useRuleLabel(): (ruleId: string) => string {
  const { rowsById } = useRuleMappings()
  const vocabularyIndex = useVocabularyIndex()
  return (ruleId) => {
    const row = rowsById.get(ruleId)
    const upstreamId = upstreamRuleId(ruleId)
    return row === undefined ? upstreamId : `${termLabel(vocabularyIndex, 'sources', row.sourceName)} ${upstreamId}`
  }
}
