import { describe, expect, it } from 'vitest'
import type { RuleRow } from '../types/rule-row'
import type { MappingHop } from './indirectMappings'
import type { MappedRule } from './mappingIndex'
import { supportingCheckOffers, type SupportingCheckOffers } from './supportingChecks'
import { automatedSupportByControl, buildSupportingChecksMarkdown, type SupportingCheckReportEntry } from './supportingChecksReport'

function link(mapping: string): MappedRule {
  return { rule: 'x', relation: 'supports', direction: 'outgoing', mapping, note: null, release: 'r1', selfRelease: 'r1' }
}

function hop(fromRuleId: string, toRuleId: string, mapping: string): MappingHop {
  return { fromRuleId, toRuleId, step: 'supports', link: link(mapping) }
}

const label = (ruleId: string) => ruleId.slice(ruleId.indexOf('.') + 1)

const directEntry: SupportingCheckReportEntry = {
  ruleId: 'mscp.os_gatekeeper_enable',
  title: 'Enable Gatekeeper',
  depth: 1,
  supports: [
    { controlId: 'asd_ism.ism-0843', path: [hop('mscp.os_gatekeeper_enable', 'asd_ism.ism-0843', 'mscp-to-ism')] },
    { controlId: 'asd_ism.ism-1234', path: [hop('mscp.os_gatekeeper_enable', 'asd_ism.ism-1234', 'mscp-to-ism')] },
  ],
}

const throughEntry: SupportingCheckReportEntry = {
  ruleId: 'mscp.os_example',
  title: 'Example',
  depth: 2,
  supports: [
    {
      controlId: 'asd_ism.ism-1234',
      path: [hop('mscp.os_example', 'asd_ism.ism-0843', 'mscp-to-ism'), hop('asd_ism.ism-0843', 'asd_ism.ism-1234', 'ism-to-ism')],
    },
  ],
}

describe('buildSupportingChecksMarkdown', () => {
  it('lists Direct, Through other rules and Excluded by you with each hop mapping id', () => {
    const markdown = buildSupportingChecksMarkdown(
      [directEntry, throughEntry],
      [{ ...directEntry, ruleId: 'mscp.pwpolicy_x', title: 'Policy' }],
      label,
    )
    expect(markdown).toContain('# Supporting checks')
    expect(markdown).toContain(
      '## Direct\n\n- **os_gatekeeper_enable** - Enable Gatekeeper\n  - Supports ism-0843 (mapping mscp-to-ism)\n  - Supports ism-1234 (mapping mscp-to-ism)',
    )
    expect(markdown).toContain(
      '## Through other rules\n\n- **os_example** - Example\n  - os_example -> supports ism-0843 -> supports ism-1234 (mappings mscp-to-ism, ism-to-ism)',
    )
    expect(markdown).toContain('## Excluded by you\n\n- **pwpolicy_x** - Policy')
    expect(markdown.endsWith('\n')).toBe(true)
    expect(markdown.endsWith('\n\n')).toBe(false)
  })

  it('leaves out empty sections', () => {
    const markdown = buildSupportingChecksMarkdown([directEntry], [], label)
    expect(markdown).not.toContain('## Through other rules')
    expect(markdown).not.toContain('## Excluded by you')
  })
})

function row(ruleId: string, status: 'automated' | 'manual'): RuleRow {
  return {
    ref: { id: ruleId, path: `${ruleId}.json` },
    title: ruleId,
    targetKeys: [],
    section: 's',
    sectionPath: ['s'],
    sourceName: ruleId.slice(0, ruleId.indexOf('.')),
    releaseTag: 'r1',
    assessment: status === 'automated' ? { status, manual_reason: null } : { status, manual_reason: 'no_check' },
    architecture: null,
    applicability: [],
    scopeKeys: [],
    benchmarks: [],
    tags: [],
    hasOdv: false,
  }
}

function entry(rule: string, direction: 'outgoing' | 'incoming'): MappedRule {
  return { rule, relation: 'supports', direction, mapping: 'm', note: null, release: 'r1', selfRelease: 'r1' }
}

describe('automatedSupportByControl', () => {
  const byRule = new Map<string, MappedRule[]>([
    ['mscp.pulled', [entry('ism.a', 'outgoing')]],
    ['mscp.excluded', [entry('ism.a', 'outgoing'), entry('ism.b', 'outgoing')]],
    ['mscp.selected', [entry('ism.b', 'outgoing')]],
    ['ism.a', [entry('mscp.pulled', 'incoming'), entry('mscp.excluded', 'incoming')]],
    ['ism.b', [entry('mscp.excluded', 'incoming'), entry('mscp.selected', 'incoming')]],
  ])
  const rowsById = new Map(
    (
      [
        ['mscp.pulled', 'automated'],
        ['mscp.excluded', 'automated'],
        ['mscp.selected', 'automated'],
        ['ism.a', 'manual'],
        ['ism.b', 'manual'],
      ] as const
    ).map(([ruleId, status]) => [ruleId, row(ruleId, status)]),
  )
  const selected = new Set(['ism.a', 'ism.b', 'mscp.selected'])
  const offers: SupportingCheckOffers = supportingCheckOffers(rowsById, byRule, selected)

  it('counts included supporters and selected automated supporters, not excluded checks', () => {
    const support = automatedSupportByControl(offers, new Set(['mscp.pulled']), new Set(['mscp.selected']), byRule)
    expect([...support]).toEqual([
      ['ism.a', ['mscp.pulled']],
      ['ism.b', ['mscp.selected']],
    ])
  })

  it('has no entry for a control whose only supporters are excluded', () => {
    const support = automatedSupportByControl(offers, new Set(), new Set(['mscp.selected']), byRule)
    expect([...support.keys()]).toEqual(['ism.b'])
  })

  it('sorts supporters by upstream id', () => {
    const support = automatedSupportByControl(offers, new Set(['mscp.excluded']), new Set(['mscp.selected']), byRule)
    expect(support.get('ism.b')).toEqual(['mscp.excluded', 'mscp.selected'])
  })
})
