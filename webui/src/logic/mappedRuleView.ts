import type { RuleRow } from '../types/rule-row'
import { compareText } from './catalogIndex'
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
}

export interface MappedSourceGroup {
  key: string
  sourceName: string
  relationLabel: string
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
    const group = groupsByKey.get(key) ?? { key, sourceName: row.sourceName, relationLabel, items: [], total: 0 }
    group.items.push({ link, row })
    group.total = group.items.length
    groupsByKey.set(key, group)
  }
  const groups = [...groupsByKey.values()]
  for (const group of groups) {
    group.items.sort((left, right) => compareText(upstreamRuleId(left.row.ref.id), upstreamRuleId(right.row.ref.id)))
  }
  return groups.sort(
    (left, right) => compareText(sourceLabel(left.sourceName), sourceLabel(right.sourceName)) || compareText(left.relationLabel, right.relationLabel),
  )
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

export function isFilterActive(filter: MappedRuleFilter): boolean {
  return filter.text.trim() !== '' || filter.assessment !== 'all'
}

export function distinctMappedRuleCount(links: readonly MappedRule[], rowsById: ReadonlyMap<string, RuleRow>): number {
  return new Set(links.map((link) => link.rule).filter((ruleId) => rowsById.has(ruleId))).size
}

function flattenMarkdown(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function discussionExcerpt(text: string, maximumCharacters: number): string {
  const plainText = flattenMarkdown(text)
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
