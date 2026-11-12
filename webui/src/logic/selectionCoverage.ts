// Selection coverage (docs/plans/2026-11-11-selection-coverage-design.md): how many
// controls of each control framework the selected rules support through
// mappings. Only `supports` links count; `related` links are reported but
// never added to the covered figure.

import type { RuleRow } from '../types/rule-row'
import { compareText } from './catalogIndex'
import type { MappedRule } from './mappingIndex'
import { upstreamRuleId } from './ruleDisplay'

export type ControlStatus = 'covered' | 'related-only' | 'uncovered'
export const ALL_CONTROLS_SCOPE = 'all'

export interface CoverageLink {
  rule: RuleRow
  mapping: string
  note: string | null
  // Either end was mapped against an older release and changed since (or the change is unknown).
  checkedAgainstOlderRelease: boolean
}

export interface ControlCoverage {
  control: RuleRow
  status: ControlStatus
  supportedBy: CoverageLink[]
  relatedTo: CoverageLink[]
  selectedDirectly: boolean
}

export interface SectionCoverage {
  section: string
  covered: number
  relatedOnly: number
  total: number
  controls: ControlCoverage[]
}

export interface FrameworkCoverage {
  sourceName: string
  scope: string
  covered: number
  relatedOnly: number
  selectedDirectly: number
  total: number
  sections: SectionCoverage[]
}

export interface CoverageInput {
  rows: readonly RuleRow[]
  mappingsByRule: ReadonlyMap<string, MappedRule[]>
  selectedRuleIds: ReadonlySet<string>
  automatedOnly: boolean
}

const STATUS_ORDER: Record<ControlStatus, number> = { covered: 0, 'related-only': 1, uncovered: 2 }

function entriesOf(mappingsByRule: ReadonlyMap<string, MappedRule[]>, ruleId: string): readonly MappedRule[] {
  return mappingsByRule.get(ruleId) ?? []
}

function sortedNames(names: Iterable<string>): string[] {
  return [...names].sort(compareText)
}

function byUpstreamId(left: RuleRow, right: RuleRow): number {
  return compareText(upstreamRuleId(left.ref.id), upstreamRuleId(right.ref.id))
}

export function coverageFrameworks(
  rows: readonly RuleRow[],
  mappingsByRule: ReadonlyMap<string, MappedRule[]>,
): { counted: string[]; relatedOnly: string[] } {
  const counted = new Set<string>()
  const supportingSources = new Set<string>()
  const relatedSources = new Set<string>()
  for (const row of rows) {
    for (const entry of entriesOf(mappingsByRule, row.ref.id)) {
      if (entry.relation === 'supports' && entry.direction === 'incoming') counted.add(row.sourceName)
      if (entry.relation === 'supports' && entry.direction === 'outgoing') supportingSources.add(row.sourceName)
      if (entry.relation === 'related') relatedSources.add(row.sourceName)
    }
  }
  const relatedOnly = [...relatedSources].filter((sourceName) => !counted.has(sourceName) && !supportingSources.has(sourceName))
  return { counted: sortedNames(counted), relatedOnly: sortedNames(relatedOnly) }
}

export function scopeOptions(
  rows: readonly RuleRow[],
  sourceName: string,
  compareBenchmarks: (left: string, right: string) => number,
): string[] {
  const benchmarks = new Set<string>()
  for (const row of rows) {
    if (row.sourceName !== sourceName) continue
    for (const benchmark of row.benchmarks) benchmarks.add(benchmark)
  }
  return [ALL_CONTROLS_SCOPE, ...[...benchmarks].sort(compareBenchmarks)]
}

function isChangedSinceMapped(kinds: MappedRule['changedKinds']): boolean {
  return kinds !== undefined && (kinds === null || kinds.length > 0)
}

function compareLinks(left: CoverageLink, right: CoverageLink): number {
  return byUpstreamId(left.rule, right.rule) || compareText(left.mapping, right.mapping)
}

function compareControls(left: ControlCoverage, right: ControlCoverage): number {
  return STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || byUpstreamId(left.control, right.control)
}

export function frameworkCoverage(input: CoverageInput, sourceName: string, scope: string): FrameworkCoverage {
  const rowsById = new Map(input.rows.map((row) => [row.ref.id, row]))
  const rowsInScope = input.rows.filter(
    (row) => row.sourceName === sourceName && (scope === ALL_CONTROLS_SCOPE || row.benchmarks.includes(scope)),
  )

  function linkFor(entry: MappedRule): CoverageLink | null {
    if (!input.selectedRuleIds.has(entry.rule)) return null
    const linkedRule = rowsById.get(entry.rule)
    if (linkedRule === undefined || linkedRule.sourceName === sourceName) return null
    if (input.automatedOnly && linkedRule.assessment.status !== 'automated') return null
    return {
      rule: linkedRule,
      mapping: entry.mapping,
      note: entry.note,
      checkedAgainstOlderRelease: isChangedSinceMapped(entry.changedKinds) || isChangedSinceMapped(entry.selfChangedKinds),
    }
  }

  function linksOf(control: RuleRow, relation: 'supports' | 'related'): CoverageLink[] {
    const wantedDirection = relation === 'supports' ? 'incoming' : 'related'
    return entriesOf(input.mappingsByRule, control.ref.id)
      .filter((entry) => entry.relation === relation && entry.direction === wantedDirection)
      .map(linkFor)
      .filter((link): link is CoverageLink => link !== null)
      .sort(compareLinks)
  }

  const controlsBySection = new Map<string, ControlCoverage[]>()
  let covered = 0
  let relatedOnly = 0
  let selectedDirectly = 0
  for (const control of rowsInScope) {
    const supportedBy = linksOf(control, 'supports')
    const relatedTo = linksOf(control, 'related')
    const status: ControlStatus = supportedBy.length > 0 ? 'covered' : relatedTo.length > 0 ? 'related-only' : 'uncovered'
    const isSelectedDirectly = input.selectedRuleIds.has(control.ref.id)
    if (status === 'covered') covered += 1
    if (status === 'related-only') relatedOnly += 1
    if (isSelectedDirectly) selectedDirectly += 1
    const section = control.sectionPath[0] ?? control.section
    const controlsOfSection = controlsBySection.get(section) ?? []
    controlsOfSection.push({ control, status, supportedBy, relatedTo, selectedDirectly: isSelectedDirectly })
    controlsBySection.set(section, controlsOfSection)
  }

  const sections: SectionCoverage[] = [...controlsBySection].map(([section, controls]) => ({
    section,
    covered: controls.filter((control) => control.status === 'covered').length,
    relatedOnly: controls.filter((control) => control.status === 'related-only').length,
    total: controls.length,
    controls: controls.sort(compareControls),
  }))

  return { sourceName, scope, covered, relatedOnly, selectedDirectly, total: rowsInScope.length, sections }
}

export function selectedRulesSupportingNothing(input: CoverageInput, frameworkSources: readonly string[]): RuleRow[] {
  const rowsById = new Map(input.rows.map((row) => [row.ref.id, row]))

  function linksIntoAFramework(row: RuleRow): boolean {
    return entriesOf(input.mappingsByRule, row.ref.id).some((entry) => {
      if (entry.relation === 'supports') return entry.direction === 'outgoing'
      const relatedRow = rowsById.get(entry.rule)
      return relatedRow !== undefined && frameworkSources.includes(relatedRow.sourceName)
    })
  }

  return input.rows
    .filter((row) => input.selectedRuleIds.has(row.ref.id) && !frameworkSources.includes(row.sourceName) && !linksIntoAFramework(row))
    .sort(byUpstreamId)
}
