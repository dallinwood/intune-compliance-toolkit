import type { RuleRow } from '../types/rule-row'
import { cachedIndirectMappedRules } from './indirectMappings'
import type { MappedRule } from './mappingIndex'
import { sourceGroupKey } from './ruleFilters'
import type { VocabularyIndex } from './vocabulary'

// Each rule's id to the source group keys of the frameworks it is linked to.
export type LinkedFrameworksByRule = ReadonlyMap<string, ReadonlySet<string>>

interface CachedLinkedFrameworks {
  byRule: ReadonlyMap<string, MappedRule[]>
  index: VocabularyIndex
  linked: LinkedFrameworksByRule
}

const linkedFrameworksCache = new WeakMap<readonly RuleRow[], CachedLinkedFrameworks>()

// A rule is linked to a framework when any mapping path reaches one of its
// rules: a direct link in either direction (supports or related), or an
// indirect one, the same chains the rule details panel lists. A rule's own
// framework is never one of its links. Worked out once per (rows, byRule,
// index) so a filter change only reads it.
export function linkedFrameworksByRule(
  rows: readonly RuleRow[],
  byRule: ReadonlyMap<string, MappedRule[]>,
  index: VocabularyIndex,
): LinkedFrameworksByRule {
  const cached = linkedFrameworksCache.get(rows)
  if (cached !== undefined && cached.byRule === byRule && cached.index === index) return cached.linked

  const rowsById = new Map(rows.map((row) => [row.ref.id, row]))
  const linked = new Map<string, ReadonlySet<string>>()
  for (const row of rows) {
    const ownFramework = sourceGroupKey(row, index)
    const reachedRuleIds = [
      ...(byRule.get(row.ref.id) ?? []).map((link) => link.rule),
      ...cachedIndirectMappedRules(row.ref.id, byRule).rules.map((indirectRule) => indirectRule.ruleId),
    ]
    const frameworks = new Set<string>()
    for (const reachedRuleId of reachedRuleIds) {
      const reachedRow = rowsById.get(reachedRuleId)
      if (reachedRow === undefined) continue
      const reachedFramework = sourceGroupKey(reachedRow, index)
      if (reachedFramework !== ownFramework) frameworks.add(reachedFramework)
    }
    if (frameworks.size > 0) linked.set(row.ref.id, frameworks)
  }
  linkedFrameworksCache.set(rows, { byRule, index, linked })
  return linked
}
