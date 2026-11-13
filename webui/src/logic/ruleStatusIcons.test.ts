import { describe, expect, it } from 'vitest'
import { NO_TARGET_KEY } from './applicability'
import type { MappedRule } from './mappingIndex'
import { linkStatusCounts, rowStatusIcons, stripAccessibleName, stripTooltipShouldOpen, targetStatus } from './ruleStatusIcons'
import { committedVocabularyIndex } from './testVocabularyFixtures'
import type { RuleRow } from '../types/rule-row'

const vocabularyIndex = committedVocabularyIndex()
const NO_LINKS = { automated: 0, manual: 0 }

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

function manualRowFor(ruleId: string, overrides: Partial<RuleRow> = {}): RuleRow {
  return rowFor(ruleId, { assessment: { status: 'manual', manual_reason: null }, ...overrides })
}

function linkTo(rule: string, overrides: Partial<MappedRule> = {}): MappedRule {
  return { rule, relation: 'supports', direction: 'incoming', mapping: 'm', note: null, release: 'r1', selfRelease: 'r1', ...overrides }
}

function rowsById(...rows: RuleRow[]): Map<string, RuleRow> {
  return new Map(rows.map((row) => [row.ref.id, row]))
}

describe('rowStatusIcons', () => {
  it("a single-target automated rule gives one green target icon", () => {
    expect(rowStatusIcons(rowFor('mscp.a'), NO_LINKS, vocabularyIndex)).toEqual([
      { kind: 'target', targetName: 'macOS', status: 'automated', label: 'macOS: automated check' },
    ])
  })

  it("every target takes the rule's status, in targetIconsOf order", () => {
    const icons = rowStatusIcons(manualRowFor('mscp.a', { targetKeys: ['Windows', 'macOS'] }), NO_LINKS, vocabularyIndex)
    expect(icons.map((icon) => [icon.targetName, icon.status, icon.label])).toEqual([
      ['macOS', 'manual', 'macOS: manual check'],
      ['Windows', 'manual', 'Windows: manual check'],
    ])
    expect(targetStatus(manualRowFor('mscp.a'), 'Windows')).toBe('manual')
  })

  it("a manual rule's labels carry the manual reason label", () => {
    const row = rowFor('mscp.a', { assessment: { status: 'manual', manual_reason: 'inherent' } })
    expect(rowStatusIcons(row, NO_LINKS, vocabularyIndex)[0].label).toBe('macOS: manual check - inherent')
  })

  it('a rule with no target gives one no-target icon', () => {
    const automated = rowFor('asd.a', { targetKeys: [NO_TARGET_KEY] })
    expect(rowStatusIcons(automated, NO_LINKS, vocabularyIndex)).toEqual([{ kind: 'no-target', status: 'automated', label: 'No platform: automated' }])
    const manual = manualRowFor('asd.b', { targetKeys: [], assessment: { status: 'manual', manual_reason: 'n_a' } })
    expect(rowStatusIcons(manual, NO_LINKS, vocabularyIndex)).toEqual([{ kind: 'no-target', status: 'manual', label: 'No platform: manual - n/a' }])
  })

  it('mixed links give an automated then a manual link icon with counts', () => {
    const icons = rowStatusIcons(rowFor('mscp.a'), { automated: 12, manual: 2 }, vocabularyIndex)
    expect(icons.slice(1)).toEqual([
      { kind: 'link', status: 'automated', label: 'Linked to 12 automated rules' },
      { kind: 'link', status: 'manual', label: 'Linked to 2 manual rules' },
    ])
  })

  it('singular and plural link labels', () => {
    const labels = rowStatusIcons(rowFor('mscp.a'), { automated: 1, manual: 1 }, vocabularyIndex).slice(1).map((icon) => icon.label)
    expect(labels).toEqual(['Linked to 1 automated rule', 'Linked to 1 manual rule'])
  })

  it('no links give no link icons', () => {
    expect(rowStatusIcons(rowFor('mscp.a'), NO_LINKS, vocabularyIndex).some((icon) => icon.kind === 'link')).toBe(false)
  })

  it('the accessible name joins the labels', () => {
    const icons = rowStatusIcons(rowFor('mscp.a'), { automated: 2, manual: 0 }, vocabularyIndex)
    expect(stripAccessibleName(icons)).toBe('macOS: automated check. Linked to 2 automated rules')
  })
})

describe('linkStatusCounts', () => {
  const linkedAutomated = rowFor('mscp.auto')
  const linkedManual = manualRowFor('asd.manual')

  it('link counts use distinct linked ids of every relation and direction', () => {
    const byRule = new Map([
      [
        'mscp.a',
        [
          linkTo('mscp.auto'),
          linkTo('mscp.auto', { direction: 'outgoing', mapping: 'other' }),
          linkTo('asd.manual', { relation: 'related', direction: 'related' }),
        ],
      ],
    ])
    expect(linkStatusCounts('mscp.a', byRule, rowsById(linkedAutomated, linkedManual))).toEqual({ automated: 1, manual: 1 })
  })

  it('linked ids missing from the library and the rule itself are ignored', () => {
    const byRule = new Map([['mscp.a', [linkTo('mscp.a'), linkTo('mscp.gone'), linkTo('mscp.auto')]]])
    expect(linkStatusCounts('mscp.a', byRule, rowsById(rowFor('mscp.a'), linkedAutomated))).toEqual({ automated: 1, manual: 0 })
  })

  it('a rule with no entry has no links', () => {
    expect(linkStatusCounts('mscp.a', new Map(), new Map())).toEqual({ automated: 0, manual: 0 })
  })
})

describe('stripTooltipShouldOpen', () => {
  it('opens only for an open request caused by keyboard focus', () => {
    expect(stripTooltipShouldOpen(true, 'trigger-focus')).toBe(true)
    expect(stripTooltipShouldOpen(true, 'trigger-hover')).toBe(false)
  })

  it.each(['trigger-hover', 'trigger-focus', 'trigger-press', 'escape-key', 'outside-press', 'none'])(
    'closes on every close request, whatever the reason (%s)',
    (reason) => {
      expect(stripTooltipShouldOpen(false, reason)).toBe(false)
    },
  )
})
