import { createContext, useContext } from 'react'
import type { MappedRule } from '../logic/mappingIndex'
import type { RuleRow } from '../types/rule-row'

export interface RuleMappings {
  byRule: ReadonlyMap<string, MappedRule[]>
  // The rows a mapped rule's label, title and release are read from.
  rowsById: ReadonlyMap<string, RuleRow>
}

// Provided once in AppShell, so the detail panel can show a rule's mapped
// rules without threading the library through every component. Without a
// provider, no rule has mappings.
export const MappingsContext = createContext<RuleMappings>({ byRule: new Map(), rowsById: new Map() })

export function useRuleMappings(): RuleMappings {
  return useContext(MappingsContext)
}
