// What the download and the attestation report say about supporting checks.
// Design: docs/plans/2026-11-12-supporting-checks-design.md, sections 7.2 and 7.3.

import { compareText } from './catalogIndex'
import { supportChain, type MappingHop } from './indirectMappings'
import type { MappedRule } from './mappingIndex'
import { upstreamRuleId } from './ruleDisplay'
import { chainText, type SupportedControlPath, type SupportingCheckOffers } from './supportingChecks'

export const SUPPORTING_CHECKS_FILE = 'supporting-checks.md'

export interface SupportingCheckReportEntry {
  ruleId: string
  title: string
  supports: SupportedControlPath[]
  depth: number
}

function distinctMappingIds(path: readonly MappingHop[]): string[] {
  return [...new Set(path.map((hop) => hop.link.mapping))]
}

function supportLine(supportedControl: SupportedControlPath, ruleLabel: (ruleId: string) => string): string {
  const { controlId, path } = supportedControl
  if (path.length === 1) return `  - Supports ${ruleLabel(controlId)} (mapping ${path[0].link.mapping})`
  return `  - ${chainText(path, ruleLabel)} (mappings ${distinctMappingIds(path).join(', ')})`
}

function entryLines(entry: SupportingCheckReportEntry, ruleLabel: (ruleId: string) => string): string[] {
  return [`- **${ruleLabel(entry.ruleId)}** - ${entry.title}`, ...entry.supports.map((control) => supportLine(control, ruleLabel))]
}

function section(heading: string, entries: readonly SupportingCheckReportEntry[], ruleLabel: (ruleId: string) => string): string[] {
  if (entries.length === 0) return []
  return [`## ${heading}`, '', ...entries.flatMap((entry) => entryLines(entry, ruleLabel)), '']
}

export function buildSupportingChecksMarkdown(
  included: readonly SupportingCheckReportEntry[],
  excluded: readonly SupportingCheckReportEntry[],
  ruleLabel: (ruleId: string) => string,
): string {
  const lines = [
    '# Supporting checks',
    '',
    'These checks were added because they support controls you selected. They were not selected',
    'themselves. Each is listed with the selected controls it supports and how.',
    '',
    ...section('Direct', included.filter((entry) => entry.depth === 1), ruleLabel),
    ...section('Through other rules', included.filter((entry) => entry.depth >= 2), ruleLabel),
    ...section('Excluded by you', excluded, ruleLabel),
  ]
  return lines.join('\n').replace(/\n+$/, '') + '\n'
}

// For each selected manual control, the automated rules in this bundle that support it: selected
// automated rules, and included supporting checks. An excluded offer is not support.
export function automatedSupportByControl(
  offers: SupportingCheckOffers,
  includedRuleIds: ReadonlySet<string>,
  selectedAutomatedRuleIds: ReadonlySet<string>,
  byRule: ReadonlyMap<string, MappedRule[]>,
): Map<string, string[]> {
  const includedOffers = [...offers.direct, ...offers.throughOtherRules].filter((offer) => includedRuleIds.has(offer.ruleId))
  const supportByControl = new Map<string, string[]>()
  for (const controlId of offers.controlsWithSupportIds) {
    const supporterIds = new Set<string>()
    for (const { ruleId } of supportChain(controlId, byRule, 'supported-by')) {
      if (selectedAutomatedRuleIds.has(ruleId)) supporterIds.add(ruleId)
    }
    for (const offer of includedOffers) {
      if (offer.supports.some((supportedControl) => supportedControl.controlId === controlId)) supporterIds.add(offer.ruleId)
    }
    if (supporterIds.size === 0) continue
    supportByControl.set(
      controlId,
      [...supporterIds].sort((left, right) => compareText(upstreamRuleId(left), upstreamRuleId(right))),
    )
  }
  return supportByControl
}
