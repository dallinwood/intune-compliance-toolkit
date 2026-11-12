import type { RuleRow } from '../types/rule-row'
import { compareText } from './catalogIndex'
import type { IndirectMappings, MappingHop, MappingStep } from './indirectMappings'
import { mappingGroupLabel, type MappedRule } from './mappingIndex'
import { upstreamRuleId } from './ruleDisplay'

export type AssessmentChoice = 'all' | 'automated' | 'manual'

export interface MappedRuleFilter {
  text: string
  assessment: AssessmentChoice
}

export interface MappedRuleItem {
  link: MappedRule
  row: RuleRow
  // Present on indirect items only; link is then the last hop's entry.
  indirect?: { path: MappingHop[]; alsoThroughRuleIds: string[] }
}

export type MappingGroupRelation = 'supports' | 'supported-by' | 'related'

const RELATION_ORDER: readonly MappingGroupRelation[] = ['supports', 'supported-by', 'related']

const RELATION_BADGE_LABELS: Record<MappingGroupRelation, string> = {
  supports: 'Supports',
  'supported-by': 'Supported by',
  related: 'Related',
}

export function relationBadgeLabel(relation: MappingGroupRelation, indirect: boolean): string {
  return indirect ? `${RELATION_BADGE_LABELS[relation]}, indirectly` : RELATION_BADGE_LABELS[relation]
}

export function groupCaption(relation: MappingGroupRelation, indirect: boolean): string {
  const adverb = indirect ? 'indirectly ' : ''
  switch (relation) {
    case 'supports':
      return `This rule ${adverb}supports each rule below.`
    case 'supported-by':
      return `Each rule below ${adverb}supports this rule.`
    case 'related':
      return `This rule is ${adverb}related to each rule below.`
  }
}

function relationOf(link: MappedRule): MappingGroupRelation {
  if (link.relation === 'related') return 'related'
  return link.direction === 'outgoing' ? 'supports' : 'supported-by'
}

export interface MappedSourceGroup {
  key: string
  sourceName: string
  relationLabel: string
  relation: MappingGroupRelation
  indirect: boolean
  items: MappedRuleItem[]
  // The group's size before any filter.
  total: number
}

export function groupMappedRulesBySource(
  links: readonly MappedRule[],
  rowsById: ReadonlyMap<string, RuleRow>,
  sourceLabel: (sourceName: string) => string,
): MappedSourceGroup[] {
  const groupsByKey = new Map<string, MappedSourceGroup>()
  for (const link of links) {
    const row = rowsById.get(link.rule)
    if (row === undefined) continue
    const relationLabel = mappingGroupLabel(link.relation, link.direction)
    const key = `${row.sourceName}:${relationLabel}`
    const group = groupsByKey.get(key) ?? { key, sourceName: row.sourceName, relationLabel, relation: relationOf(link), indirect: false, items: [], total: 0 }
    group.items.push({ link, row })
    group.total = group.items.length
    groupsByKey.set(key, group)
  }
  const groups = [...groupsByKey.values()]
  for (const group of groups) {
    group.items.sort((left, right) => compareText(upstreamRuleId(left.row.ref.id), upstreamRuleId(right.row.ref.id)))
  }
  return sortGroups(groups, sourceLabel)
}

export interface IndirectPathBlock {
  // The through rule ids joined.
  key: string
  throughRuleIds: string[]
  // The step into each through rule.
  throughSteps: MappingStep[]
  groups: MappedSourceGroup[]
  // The block's size before any filter.
  total: number
}

function sortGroups(groups: MappedSourceGroup[], sourceLabel: (sourceName: string) => string): MappedSourceGroup[] {
  return groups.sort(
    (left, right) =>
      RELATION_ORDER.indexOf(left.relation) - RELATION_ORDER.indexOf(right.relation) ||
      compareText(sourceLabel(left.sourceName), sourceLabel(right.sourceName)) ||
      compareText(left.relationLabel, right.relationLabel),
  )
}

export function groupIndirectMappedRules(
  indirect: IndirectMappings,
  rowsById: ReadonlyMap<string, RuleRow>,
  sourceLabel: (sourceName: string) => string,
): IndirectPathBlock[] {
  const blocksByKey = new Map<string, IndirectPathBlock>()
  for (const rule of indirect.rules) {
    const row = rowsById.get(rule.ruleId)
    if (row === undefined) continue
    const throughHops = rule.path.slice(0, -1)
    const throughRuleIds = throughHops.map((hop) => hop.toRuleId)
    const key = throughRuleIds.join('\n')
    const block = blocksByKey.get(key) ?? { key, throughRuleIds, throughSteps: throughHops.map((hop) => hop.step), groups: [], total: 0 }
    const relationLabel = relationBadgeLabel(rule.effectiveRelation, true)
    const groupKey = `${row.sourceName}:${relationLabel}`
    let group = block.groups.find((candidate) => candidate.key === groupKey)
    if (group === undefined) {
      group = { key: groupKey, sourceName: row.sourceName, relationLabel, relation: rule.effectiveRelation, indirect: true, items: [], total: 0 }
      block.groups.push(group)
    }
    group.items.push({
      link: rule.path[rule.path.length - 1].link,
      row,
      indirect: { path: rule.path, alsoThroughRuleIds: rule.alsoThroughRuleIds },
    })
    group.total = group.items.length
    block.total += 1
    blocksByKey.set(key, block)
  }

  const sourceLabelOfRule = (ruleId: string) => {
    const row = rowsById.get(ruleId)
    return row === undefined ? ruleId : sourceLabel(row.sourceName)
  }
  const blocks = [...blocksByKey.values()]
  for (const block of blocks) {
    for (const group of block.groups) {
      group.items.sort((left, right) => compareText(upstreamRuleId(left.row.ref.id), upstreamRuleId(right.row.ref.id)))
    }
    sortGroups(block.groups, sourceLabel)
  }
  return blocks.sort((left, right) => {
    const byDepth = left.throughRuleIds.length - right.throughRuleIds.length
    if (byDepth !== 0) return byDepth
    for (const [position, leftRuleId] of left.throughRuleIds.entries()) {
      const rightRuleId = right.throughRuleIds[position]
      const byThroughRule =
        compareText(sourceLabelOfRule(leftRuleId), sourceLabelOfRule(rightRuleId)) ||
        compareText(upstreamRuleId(leftRuleId), upstreamRuleId(rightRuleId))
      if (byThroughRule !== 0) return byThroughRule
    }
    return compareText(left.key, right.key)
  })
}

const STEP_INTO_FIRST_RULE: Record<MappingStep, string> = {
  supports: 'this rule supports it',
  'supported-by': 'this rule is supported by it',
  related: 'this rule is related to it',
}

const STEP_INTO_LATER_RULE: Record<MappingStep, string> = {
  supports: 'supports it',
  'supported-by': 'is supported by it',
  related: 'related to it',
}

export function throughDescription(block: IndirectPathBlock, ruleLabel: (ruleId: string) => string): string {
  const parts = block.throughRuleIds.map((ruleId, position) => {
    const wording = position === 0 ? STEP_INTO_FIRST_RULE : STEP_INTO_LATER_RULE
    return `${ruleLabel(ruleId)} (${wording[block.throughSteps[position]]})`
  })
  return `Through ${parts.join(', then ')}`
}

function itemMatches(item: MappedRuleItem, filter: MappedRuleFilter): boolean {
  if (filter.assessment !== 'all' && item.row.assessment.status !== filter.assessment) return false
  const needle = filter.text.trim().toLowerCase()
  if (needle === '') return true
  return upstreamRuleId(item.row.ref.id).toLowerCase().includes(needle) || item.row.title.toLowerCase().includes(needle)
}

export function filterMappedRuleGroups(groups: readonly MappedSourceGroup[], filter: MappedRuleFilter): MappedSourceGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => itemMatches(item, filter)) }))
    .filter((group) => group.items.length > 0)
}

export function filterIndirectPathBlocks(blocks: readonly IndirectPathBlock[], filter: MappedRuleFilter): IndirectPathBlock[] {
  return blocks
    .map((block) => ({ ...block, groups: filterMappedRuleGroups(block.groups, filter) }))
    .filter((block) => block.groups.length > 0)
}

export function isFilterActive(filter: MappedRuleFilter): boolean {
  return filter.text.trim() !== '' || filter.assessment !== 'all'
}

export function distinctMappedRuleCount(links: readonly MappedRule[], rowsById: ReadonlyMap<string, RuleRow>): number {
  return new Set(links.map((link) => link.rule).filter((ruleId) => rowsById.has(ruleId))).size
}

// The first AsciiDoc block attribute or delimiter line ends the prose; what follows is a note, code or a table.
const ASCIIDOC_BLOCK_START = /^\s*(\[(NOTE|IMPORTANT|source[^\]]*)\]|-{4,}|={4,})\s*$/m

function leadingProse(text: string): string {
  const blockStart = text.search(ASCIIDOC_BLOCK_START)
  return blockStart === -1 ? text : text.slice(0, blockStart)
}

function flattenMarkup(text: string): string {
  return leadingProse(text)
    .replace(/link:\S+?\[([^\]]*)\]/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*`~]+/g, '')
    // An underscore is emphasis only at a word boundary; inside an identifier like os_airdrop_disable it is part of the name.
    .replace(/(?<![A-Za-z0-9_])_+(?=\S)|(?<=\S)_+(?![A-Za-z0-9])/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function discussionExcerpt(text: string, maximumCharacters: number): string {
  const plainText = flattenMarkup(text)
  if (plainText.length <= maximumCharacters) return plainText
  let kept = ''
  for (const word of plainText.split(' ')) {
    const candidate = kept === '' ? word : `${kept} ${word}`
    if (candidate.length > maximumCharacters) break
    kept = candidate
  }
  if (kept === '') kept = plainText.slice(0, maximumCharacters)
  return `${kept}...`
}
