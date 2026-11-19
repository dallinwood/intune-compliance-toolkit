import { displayWithOdvs } from '../logic/odv'
import type { RuleRow } from '../types/rule-row'
import { useRule, useUsableOdvValues } from './useRule'

const ODV_PLACEHOLDER_PREFIX = '$ODV_'

// A row's title as the table shows it: each $ODV_<name> replaced by the value
// the rule would use. Only titles that mention $ODV_ need the rule's
// recommended values, so only those fetch the full rule (cached by fetchRule).
export function useDisplayTitle(row: RuleRow): string {
  const needsValues = row.hasOdv && row.title.includes(ODV_PLACEHOLDER_PREFIX)
  const ruleState = useRule(needsValues ? row.ref : null)
  const values = useUsableOdvValues(ruleState.status === 'ready' ? ruleState.rule : null, row.ref)
  return displayWithOdvs(row.title, values)
}
