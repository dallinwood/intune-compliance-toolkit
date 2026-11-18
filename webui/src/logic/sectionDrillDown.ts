// The section breakdown of a coverage report (docs/plans/2026-11-18-unified-frameworks-design.md,
// "Section breakdown and drill-down"): which sections of the covered framework are within reach,
// each with its own cap, and what opening one lists.

import type { RuleRow } from '../types/rule-row'
import { compareText } from './catalogIndex'
import { capCount } from './frameworkPairs'
import { supportChain } from './indirectMappings'
import type { MappedRule } from './mappingIndex'
import { upstreamRuleId } from './ruleDisplay'
import type { ControlStatus, FrameworkCoverage, SectionCoverage } from './selectionCoverage'

export interface SectionWithinReach {
  section: SectionCoverage
  capCount: number
}

export interface CoveringRuleInSection {
  rule: RuleRow
  // Sorted by upstream id.
  supportedControlIds: string[]
}

// Both coverages come from the same rows and scope, so they hold the same sections in the same order.
export function sectionsWithinReach(coverage: FrameworkCoverage, cap: FrameworkCoverage): SectionWithinReach[] {
  const displayedSections = new Map(coverage.sections.map((section) => [section.section, section]))
  return cap.sections
    .map((capSection, sectionOrder) => ({ sectionOrder, capCount: capCount(capSection), section: displayedSections.get(capSection.section) }))
    .filter((entry): entry is { sectionOrder: number; capCount: number; section: SectionCoverage } => entry.capCount > 0 && entry.section !== undefined)
    .sort((left, right) => right.capCount - left.capCount || left.sectionOrder - right.sectionOrder)
    .map(({ section, capCount: sectionCap }) => ({ section, capCount: sectionCap }))
}

export function coveringRulesInSection(
  coveringRows: readonly RuleRow[],
  byRule: ReadonlyMap<string, MappedRule[]>,
  sectionControlIds: ReadonlySet<string>,
  automatedOnly: boolean,
): CoveringRuleInSection[] {
  const byControlId = (left: string, right: string) => compareText(upstreamRuleId(left), upstreamRuleId(right))
  return coveringRows
    .filter((row) => !automatedOnly || row.assessment.status === 'automated')
    .map((row) => ({
      rule: row,
      supportedControlIds: supportChain(row.ref.id, byRule, 'supports')
        .map((reached) => reached.ruleId)
        .filter((ruleId) => sectionControlIds.has(ruleId))
        .sort(byControlId),
    }))
    .filter((entry) => entry.supportedControlIds.length > 0)
    .sort((left, right) => byControlId(left.rule.ref.id, right.rule.ref.id))
}

export function selectedFirst<Item>(items: readonly Item[], isSelected: (item: Item) => boolean): { selected: Item[]; unselected: Item[] } {
  return { selected: items.filter(isSelected), unselected: items.filter((item) => !isSelected(item)) }
}

const STATUS_TEXT: Record<ControlStatus, string> = {
  covered: 'Covered directly',
  'covered-through-supporting': 'Covered through supporting checks',
  'related-only': 'Related only',
  uncovered: 'Not covered',
}

export function controlStatusText(status: ControlStatus): string {
  return STATUS_TEXT[status]
}
