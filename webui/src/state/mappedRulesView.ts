import { useState } from 'react'
import type { IndirectPathBlock, MappedRuleFilter } from '../logic/mappedRuleView'

export interface MappedRulesViewState {
  filter: MappedRuleFilter
  setFilter: (filter: MappedRuleFilter) => void
  openGroupKeys: ReadonlySet<string>
  toggleGroup: (groupKey: string) => void
  expandedRuleIds: ReadonlySet<string>
  toggleRule: (ruleId: string) => void
  // Indirect rows whose "How this is linked" list is showing, by rule id.
  openHopListRuleIds: ReadonlySet<string>
  toggleHopList: (ruleId: string) => void
}

// Indirect groups repeat a source and relation in every path block, so their open state is keyed by the block too.
export function indirectGroupKey(block: IndirectPathBlock, groupKey: string): string {
  return `indirect:${block.key}|${groupKey}`
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
  const [openHopListRuleIds, setOpenHopListRuleIds] = useState<ReadonlySet<string>>(new Set())
  return {
    filter,
    setFilter,
    openGroupKeys,
    toggleGroup: (groupKey) => setOpenGroupKeys((previous) => toggled(previous, groupKey)),
    expandedRuleIds,
    toggleRule: (ruleId) => setExpandedRuleIds((previous) => toggled(previous, ruleId)),
    openHopListRuleIds,
    toggleHopList: (ruleId) => setOpenHopListRuleIds((previous) => toggled(previous, ruleId)),
  }
}
