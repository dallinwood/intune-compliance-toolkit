import { useState } from 'react'
import type { MappedRuleFilter } from '../logic/mappedRuleView'

export interface MappedRulesViewState {
  filter: MappedRuleFilter
  setFilter: (filter: MappedRuleFilter) => void
  openGroupKeys: ReadonlySet<string>
  toggleGroup: (groupKey: string) => void
  expandedRuleIds: ReadonlySet<string>
  toggleRule: (ruleId: string) => void
}

function toggled(previous: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(previous)
  if (!next.delete(key)) next.add(key)
  return next
}

// Kept by the open rule's panel rather than the tab, so switching to Details and
// back keeps the filter, the open groups and the expanded rows, while collapsing
// the rule resets them.
export function useMappedRulesViewState(): MappedRulesViewState {
  const [filter, setFilter] = useState<MappedRuleFilter>({ text: '', assessment: 'all' })
  const [openGroupKeys, setOpenGroupKeys] = useState<ReadonlySet<string>>(new Set())
  const [expandedRuleIds, setExpandedRuleIds] = useState<ReadonlySet<string>>(new Set())
  return {
    filter,
    setFilter,
    openGroupKeys,
    toggleGroup: (groupKey) => setOpenGroupKeys((previous) => toggled(previous, groupKey)),
    expandedRuleIds,
    toggleRule: (ruleId) => setExpandedRuleIds((previous) => toggled(previous, ruleId)),
  }
}
