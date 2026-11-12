// Automated checks of rules that support a selected control, offered for the
// Generate and Coverage views. Design: docs/plans/2026-11-12-supporting-checks-design.md.
//
// Only `supports` hops are followed (supportChain), never peers or `related`
// links, so the offer list stays bounded by the number of supporting rules.

import { compareText } from './catalogIndex'
import { supportChain, type MappingHop } from './indirectMappings'
import type { MappedRule } from './mappingIndex'
import { upstreamRuleId } from './ruleDisplay'
import type { RuleRow } from '../types/rule-row'

export interface SupportedControlPath {
  controlId: string
  // From the supporting rule up to controlId; every step is 'supports'. Length >= 1.
  path: MappingHop[]
}

export interface SupportingCheckOffer {
  ruleId: string
  // Smallest path length to any selected control: 1 = direct.
  depth: number
  // Every selected control it supports, by upstream id, each with its shortest path.
  supports: SupportedControlPath[]
}

export interface SupportingCheckOffers {
  direct: SupportingCheckOffer[]
  throughOtherRules: SupportingCheckOffer[]
  // Selected automated rules that support a selected control; not offered.
  alreadySelectedSupporterIds: string[]
  // Selected manual rules with at least one automated supporter, offered or already selected.
  controlsWithSupportIds: string[]
}

export interface SupportingCheckChoices {
  includeSupporting: boolean
  // Only choices that differ from the default for that rule's depth are stored.
  overrides: Record<string, 'include' | 'exclude'>
}

export const DEFAULT_SUPPORTING_CHECK_CHOICES: SupportingCheckChoices = { includeSupporting: false, overrides: {} }

function compareByUpstreamId(leftRuleId: string, rightRuleId: string): number {
  return compareText(upstreamRuleId(leftRuleId), upstreamRuleId(rightRuleId))
}

// supportChain walks control -> supporter with 'supported-by' steps; every display reads
// supporter -> control, so each hop is turned around. The index entry is the other side's
// view of the same link, so its releases and change notes swap with it.
function reversedSupportPath(pathFromControl: readonly MappingHop[]): MappingHop[] {
  return [...pathFromControl].reverse().map((hop): MappingHop => {
    const { link } = hop
    const linkSeenFromSupporter: MappedRule = {
      ...link,
      rule: hop.fromRuleId,
      direction: 'outgoing',
      release: link.selfRelease,
      selfRelease: link.release,
      ...(link.selfChangedKinds === undefined ? {} : { changedKinds: link.selfChangedKinds }),
      ...(link.changedKinds === undefined ? {} : { selfChangedKinds: link.changedKinds }),
    }
    return { fromRuleId: hop.toRuleId, toRuleId: hop.fromRuleId, step: 'supports', link: linkSeenFromSupporter }
  })
}

export function supportingCheckOffers(
  rowsById: ReadonlyMap<string, RuleRow>,
  byRule: ReadonlyMap<string, MappedRule[]>,
  selectedRuleIds: ReadonlySet<string>,
): SupportingCheckOffers {
  const supportedControlsBySupporter = new Map<string, SupportedControlPath[]>()
  const alreadySelectedSupporterIds = new Set<string>()
  const controlsWithSupportIds = new Set<string>()

  for (const controlId of selectedRuleIds) {
    if (rowsById.get(controlId)?.assessment.status !== 'manual') continue
    for (const { ruleId: supporterId, path } of supportChain(controlId, byRule, 'supported-by')) {
      if (rowsById.get(supporterId)?.assessment.status !== 'automated') continue
      controlsWithSupportIds.add(controlId)
      if (selectedRuleIds.has(supporterId)) {
        alreadySelectedSupporterIds.add(supporterId)
        continue
      }
      const supportedControls = supportedControlsBySupporter.get(supporterId) ?? []
      supportedControls.push({ controlId, path: reversedSupportPath(path) })
      supportedControlsBySupporter.set(supporterId, supportedControls)
    }
  }

  const offers = [...supportedControlsBySupporter].map(
    ([ruleId, supportedControls]): SupportingCheckOffer => ({
      ruleId,
      depth: Math.min(...supportedControls.map((supportedControl) => supportedControl.path.length)),
      supports: supportedControls.sort((left, right) => compareByUpstreamId(left.controlId, right.controlId)),
    }),
  )
  return {
    direct: offers.filter((offer) => offer.depth === 1).sort((left, right) => compareByUpstreamId(left.ruleId, right.ruleId)),
    throughOtherRules: offers
      .filter((offer) => offer.depth >= 2)
      .sort((left, right) => left.depth - right.depth || compareByUpstreamId(left.ruleId, right.ruleId)),
    alreadySelectedSupporterIds: [...alreadySelectedSupporterIds].sort(compareByUpstreamId),
    controlsWithSupportIds: [...controlsWithSupportIds].sort(compareByUpstreamId),
  }
}

export function isSupportingCheckIncluded(offer: SupportingCheckOffer, choices: SupportingCheckChoices): boolean {
  if (!choices.includeSupporting) return false
  const override = choices.overrides[offer.ruleId]
  if (override !== undefined) return override === 'include'
  return offer.depth === 1
}

export function includedSupportingRuleIds(offers: SupportingCheckOffers, choices: SupportingCheckChoices): string[] {
  return [...offers.direct, ...offers.throughOtherRules].filter((offer) => isSupportingCheckIncluded(offer, choices)).map((offer) => offer.ruleId)
}

export function pruneSupportingCheckChoices(choices: SupportingCheckChoices, offers: SupportingCheckOffers): SupportingCheckChoices {
  const offeredRuleIds = new Set([...offers.direct, ...offers.throughOtherRules].map((offer) => offer.ruleId))
  const keptOverrides = Object.entries(choices.overrides).filter(([ruleId]) => offeredRuleIds.has(ruleId))
  if (keptOverrides.length === Object.keys(choices.overrides).length) return choices
  return { ...choices, overrides: Object.fromEntries(keptOverrides) }
}

// "a -> supports b -> supports c"
export function chainText(path: readonly MappingHop[], ruleLabel: (ruleId: string) => string): string {
  return [ruleLabel(path[0].fromRuleId), ...path.map((hop) => `supports ${ruleLabel(hop.toRuleId)}`)].join(' -> ')
}

// "a supports b, which supports c"
export function chainAccessibleText(path: readonly MappingHop[], ruleLabel: (ruleId: string) => string): string {
  const [firstHop, ...laterHops] = path
  const first = `${ruleLabel(firstHop.fromRuleId)} supports ${ruleLabel(firstHop.toRuleId)}`
  return [first, ...laterHops.map((hop) => `which supports ${ruleLabel(hop.toRuleId)}`)].join(', ')
}
