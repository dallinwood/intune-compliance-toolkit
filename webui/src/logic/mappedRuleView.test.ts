import { describe, expect, it } from 'vitest'
import type { RuleRow } from '../types/rule-row'
import type { MappedRule } from './mappingIndex'
import {
  discussionExcerpt,
  distinctMappedRuleCount,
  filterMappedRuleGroups,
  groupMappedRulesBySource,
  isFilterActive,
} from './mappedRuleView'

function rowFor(ruleId: string, overrides: Partial<RuleRow> = {}): RuleRow {
  const sourceName = ruleId.slice(0, ruleId.indexOf('.'))
  return {
    ref: { id: ruleId, path: `${sourceName}/rules/${ruleId}.json` },
    title: `Title of ${ruleId}`,
    targetKeys: ['macOS'],
    section: 'os',
    sectionPath: ['os'],
    sourceName,
    releaseTag: 'r1',
    assessment: { status: 'automated', manual_reason: null },
    architecture: null,
    applicability: [],
    scopeKeys: [],
    benchmarks: [],
    tags: [],
    hasOdv: false,
    ...overrides,
  }
}

function linkTo(rule: string, direction: MappedRule['direction'] = 'incoming'): MappedRule {
  return { rule, relation: direction === 'related' ? 'related' : 'supports', direction, mapping: 'm', note: null, release: 'r1', selfRelease: 'r1' }
}

function rowsMap(...rows: RuleRow[]): Map<string, RuleRow> {
  return new Map(rows.map((row) => [row.ref.id, row]))
}

const sourceLabel = (sourceName: string) => sourceName

describe('groupMappedRulesBySource', () => {
  it("groups by the mapped rule's source and relation, ordered by source label then upstream id", () => {
    const rows = rowsMap(rowFor('mscp.os_a'), rowFor('mscp.os_b'), rowFor('asd_ism.ism-0001'))
    const groups = groupMappedRulesBySource(
      [linkTo('mscp.os_b'), linkTo('mscp.os_a'), linkTo('asd_ism.ism-0001', 'outgoing')],
      rows,
      sourceLabel,
    )
    expect(groups.map((group) => group.key)).toEqual(['asd_ism:Supports', 'mscp:Supported by'])
    expect(groups[1].items.map((item) => item.row.ref.id)).toEqual(['mscp.os_a', 'mscp.os_b'])
    for (const group of groups) expect(group.total).toBe(group.items.length)
  })

  it('orders groups by the source label rather than the source name', () => {
    const rows = rowsMap(rowFor('alpha.one'), rowFor('beta.two'))
    const groups = groupMappedRulesBySource([linkTo('alpha.one'), linkTo('beta.two')], rows, (name) => (name === 'alpha' ? 'Zed' : 'Aardvark'))
    expect(groups.map((group) => group.sourceName)).toEqual(['beta', 'alpha'])
  })

  it('drops links whose rule is not in the loaded rows', () => {
    const groups = groupMappedRulesBySource([linkTo('mscp.os_a'), linkTo('mscp.missing')], rowsMap(rowFor('mscp.os_a')), sourceLabel)
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((item) => item.row.ref.id)).toEqual(['mscp.os_a'])
    expect(groups[0].total).toBe(1)
  })
})

describe('filterMappedRuleGroups', () => {
  const airdrop = rowFor('mscp.os_airdrop_disable', { title: 'Disable AirDrop' })
  const rows = rowsMap(airdrop, rowFor('mscp.os_a'), rowFor('mscp.os_b'))
  const groups = groupMappedRulesBySource([linkTo('mscp.os_airdrop_disable'), linkTo('mscp.os_a'), linkTo('mscp.os_b')], rows, sourceLabel)

  it('text filter matches upstream id or title, case-insensitively, and keeps total', () => {
    const byTitle = filterMappedRuleGroups(groups, { text: 'AIRDROP', assessment: 'all' })
    expect(byTitle).toHaveLength(1)
    expect(byTitle[0].items).toHaveLength(1)
    expect(byTitle[0].total).toBe(3)
    const byId = filterMappedRuleGroups(groups, { text: 'OS_B', assessment: 'all' })
    expect(byId[0].items.map((item) => item.row.ref.id)).toEqual(['mscp.os_b'])
  })

  it('assessment filter keeps only automated or manual rows', () => {
    const manualRow = rowFor('mscp.os_manual', { assessment: { status: 'manual', manual_reason: 'manual' } })
    const mixed = groupMappedRulesBySource([linkTo('mscp.os_a'), linkTo('mscp.os_manual')], rowsMap(rowFor('mscp.os_a'), manualRow), sourceLabel)
    const automated = filterMappedRuleGroups(mixed, { text: '', assessment: 'automated' })
    expect(automated[0].items.map((item) => item.row.ref.id)).toEqual(['mscp.os_a'])
    const manual = filterMappedRuleGroups(mixed, { text: '', assessment: 'manual' })
    expect(manual[0].items.map((item) => item.row.ref.id)).toEqual(['mscp.os_manual'])
  })

  it('a filter that matches nothing returns no groups', () => {
    expect(filterMappedRuleGroups(groups, { text: 'zzz-no-match', assessment: 'all' })).toEqual([])
  })
})

describe('isFilterActive', () => {
  it('is false for blank text and all', () => {
    expect(isFilterActive({ text: '  ', assessment: 'all' })).toBe(false)
  })

  it('is true for text or a narrowed assessment', () => {
    expect(isFilterActive({ text: 'x', assessment: 'all' })).toBe(true)
    expect(isFilterActive({ text: '', assessment: 'manual' })).toBe(true)
  })
})

describe('distinctMappedRuleCount', () => {
  it('counts distinct mapped rules once even if linked twice', () => {
    const rows = rowsMap(rowFor('mscp.os_a'), rowFor('mscp.os_b'))
    expect(distinctMappedRuleCount([linkTo('mscp.os_a'), linkTo('mscp.os_a', 'related'), linkTo('mscp.os_b')], rows)).toBe(2)
  })

  it('ignores rules that are not loaded', () => {
    expect(distinctMappedRuleCount([linkTo('mscp.gone')], rowsMap())).toBe(0)
  })
})

describe('discussionExcerpt', () => {
  it('flattens markdown and cuts at a word', () => {
    expect(discussionExcerpt('**Bold** text with `code` and [a link](https://x)\n\nNext para', 30)).toBe('Bold text with code and a link...')
  })

  it('keeps underscores inside identifiers and strips them as emphasis', () => {
    expect(discussionExcerpt('Use os_airdrop_disable and _emphasis_ here', 100)).toBe('Use os_airdrop_disable and emphasis here')
    expect(discussionExcerpt('A __strong__ word', 100)).toBe('A strong word')
  })

  it('returns a short input unchanged, without an ellipsis', () => {
    expect(discussionExcerpt('Short text.', 100)).toBe('Short text.')
  })
})
