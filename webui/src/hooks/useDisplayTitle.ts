import { displayWithOdv } from '../logic/odv'
import type { RuleRow } from '../types/rule-row'
import { useRule, useUsableOdvValue } from './useRule'

const ODV_PLACEHOLDER = '$ODV'

// A row's title as the table shows it: $ODV replaced by the value the rule
// would use. Only titles that mention $ODV need the rule's recommended
// value, so only those fetch the full rule (cached by fetchRule).
export function useDisplayTitle(row: RuleRow): string {
  const needsValue = row.hasOdv && row.title.includes(ODV_PLACEHOLDER)
  const ruleState = useRule(needsValue ? row.ref : null)
  const value = useUsableOdvValue(ruleState.status === 'ready' ? ruleState.rule : null, row.ref)
  return displayWithOdv(row.title, value)
}
