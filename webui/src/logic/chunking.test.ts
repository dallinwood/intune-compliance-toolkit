import { describe, expect, it } from 'vitest'
import { classifyRule, packChunks } from './chunking'
import { createSelectionEntry, type RuleRef, type SelectionEntry } from './selectionEntry'
import type { RuleDetail } from '../types/rule-detail'
import type { IntuneRuleEntry } from './rulesJsonGen'

const REF: RuleRef = { family: 'cis', product: 'macos_26_tahoe', version: 'v1.1.0', file: 'cis_macos26_1.6.json', id: '1.6' }

function minimalRule(overrides: Partial<RuleDetail> = {}): RuleDetail {
  return {
    id: '1.6',
    title: 'Ensure Something',
    assessment_status: 'Automated',
    benchmark: { product: 'Test Benchmark', version: '1.0.0', platform: 'macOS' },
    profile_applicability: ['Level 1'],
    recommended_state: null,
    description: 'desc',
    rationale: 'rationale',
    impact: 'impact',
    audit: {
      methods: [
        {
          method_name: 'Terminal Method',
          type: 'scripted',
          description: '...',
          steps: [
            {
              step_role: 'compliance_check',
              original_command: null,
              check_command: 'test_var=1',
              check_command_verified: true,
              output_description: '...',
              output_check: [{ variable: 'test_var', data_type: 'integer', operator: 'eq', value: 1, value_source: 'benchmark' }],
            },
          ],
        },
      ],
    },
    remediation: { methods: [] },
    default_value: null,
    references: [],
    additional_information: null,
    ...overrides,
  }
}

describe('classifyRule', () => {
  it('classifies a fully benchmark-defined scripted rule as generatable', () => {
    const result = classifyRule(REF, minimalRule(), createSelectionEntry(REF))

    expect(result.kind).toBe('generatable')
    if (result.kind === 'generatable') {
      expect(result.rule.ruleEntries).toHaveLength(1)
      expect(result.rule.ruleEntries[0].SettingName).toBe('test_var')
      expect(result.rule.platform).toBe('macOS')
    }
  })

  it('classifies a rule with no scripted method as manual', () => {
    const rule = minimalRule({
      audit: { methods: [{ method_name: 'Graphical Method', type: 'manual', description: '...' }] },
    })

    const result = classifyRule(REF, rule, createSelectionEntry(REF))

    expect(result.kind).toBe('manual')
  })

  it('classifies a rule using an unsupported operator (contains/like) as manual', () => {
    const rule = minimalRule()
    rule.audit.methods[0].steps![0].output_check[0].operator = 'contains'

    const result = classifyRule(REF, rule, createSelectionEntry(REF))

    expect(result.kind).toBe('manual')
    if (result.kind === 'manual') {
      expect(result.entry.reason).toMatch(/operator/i)
    }
  })

  it('classifies a rule missing a required organization-defined value as blocked, not manual', () => {
    const rule = minimalRule()
    rule.audit.methods[0].steps![0].output_check[0] = {
      variable: 'test_var',
      data_type: 'boolean',
      operator: 'eq',
      value: null,
      value_source: 'organization_defined',
    }

    const result = classifyRule(REF, rule, createSelectionEntry(REF))

    expect(result.kind).toBe('blocked')
    if (result.kind === 'blocked') {
      expect(result.entry.missingVariables).toEqual(['test_var'])
    }
  })

  it('classifies as generatable once the organization-defined value is provided', () => {
    const rule = minimalRule()
    rule.audit.methods[0].steps![0].output_check[0] = {
      variable: 'test_var',
      data_type: 'boolean',
      operator: 'eq',
      value: null,
      value_source: 'organization_defined',
    }
    const selection: SelectionEntry = { ...createSelectionEntry(REF), organizationDefinedValues: { test_var: true } }

    const result = classifyRule(REF, rule, selection)

    expect(result.kind).toBe('generatable')
  })

  it('uses the audit method the selection explicitly picked among 2+ scripted methods', () => {
    const rule = minimalRule({
      audit: {
        methods: [
          {
            method_name: 'Method A',
            type: 'scripted',
            description: '...',
            steps: [
              {
                step_role: 'compliance_check',
                original_command: null,
                check_command: 'a=1',
                check_command_verified: true,
                output_description: '',
                output_check: [{ variable: 'var_a', data_type: 'integer', operator: 'eq', value: 1, value_source: 'benchmark' }],
              },
            ],
          },
          {
            method_name: 'Method B',
            type: 'scripted',
            description: '...',
            steps: [
              {
                step_role: 'compliance_check',
                original_command: null,
                check_command: 'b=2',
                check_command_verified: true,
                output_description: '',
                output_check: [{ variable: 'var_b', data_type: 'integer', operator: 'eq', value: 2, value_source: 'benchmark' }],
              },
            ],
          },
        ],
      },
    })
    const selection: SelectionEntry = { ...createSelectionEntry(REF), selectedAuditMethodIndex: 1 }

    const result = classifyRule(REF, rule, selection)

    expect(result.kind).toBe('generatable')
    if (result.kind === 'generatable') {
      expect(result.rule.ruleEntries[0].SettingName).toBe('var_b')
    }
  })
})

function ruleEntry(settingName: string, sizeFiller = ''): IntuneRuleEntry {
  return {
    SettingName: settingName,
    Operator: 'IsEquals',
    DataType: 'String',
    Operand: sizeFiller,
    RemediationStrings: [{ Language: 'en_US', Title: 't', Description: 'd' }],
  }
}

function generatableRule(id: string, platform: string, entries: IntuneRuleEntry[]) {
  return {
    ref: { family: 'cis', product: 'p', version: 'v1', file: `${id}.json`, id },
    id,
    title: `Rule ${id}`,
    platform,
    steps: [],
    ruleEntries: entries,
  }
}

describe('packChunks', () => {
  it('never combines two different top-level sections into one chunk, even with spare room', () => {
    const rules = [
      generatableRule('1.1', 'macOS', [ruleEntry('var_1_1')]),
      generatableRule('2.1', 'macOS', [ruleEntry('var_2_1')]),
    ]

    const chunks = packChunks(rules)

    expect(chunks).toHaveLength(2)
    expect(chunks.map((chunk) => chunk.section).sort()).toEqual(['1', '2'])
  })

  it('groups by platform separately even within the same section', () => {
    const rules = [
      generatableRule('1.1', 'macOS', [ruleEntry('mac_var')]),
      generatableRule('1.2', 'Windows 11 (Intune)', [ruleEntry('win_var')]),
    ]

    const chunks = packChunks(rules)

    expect(chunks.map((chunk) => chunk.platform).sort()).toEqual(['Windows 11 (Intune)', 'macOS'])
  })

  it('sorts rules and sections using natural id order, not string order', () => {
    const rules = [
      generatableRule('106.1.1', 'macOS', [ruleEntry('v106')]),
      generatableRule('2.12.2', 'macOS', [ruleEntry('v2_12_2')]),
      generatableRule('1.6', 'macOS', [ruleEntry('v1_6')]),
      generatableRule('2.1.1.1', 'macOS', [ruleEntry('v2_1_1_1')]),
    ]

    const chunks = packChunks(rules)

    expect(chunks.map((chunk) => chunk.section)).toEqual(['1', '2', '106'])
    const section2 = chunks.find((chunk) => chunk.section === '2')!
    expect(section2.rules.map((rule) => rule.id)).toEqual(['2.1.1.1', '2.12.2'])
  })

  it('only assigns a part number when a section splits into more than one chunk', () => {
    const rules = [generatableRule('1.1', 'macOS', [ruleEntry('v1')])]

    const chunks = packChunks(rules)

    expect(chunks[0].partNumber).toBeNull()
  })

  it('splits a section into parts once the rule-count cap is exceeded', () => {
    const rules = Array.from({ length: 5 }, (_, index) => generatableRule(`1.${index + 1}`, 'macOS', [ruleEntry(`v${index}`)]))

    const chunks = packChunks(rules, { maxRulesPerChunk: 2, maxBytesPerChunk: 1_000_000 })

    expect(chunks).toHaveLength(3)
    expect(chunks.map((chunk) => chunk.partNumber)).toEqual([1, 2, 3])
    expect(chunks.flatMap((chunk) => chunk.rules.map((rule) => rule.id))).toEqual(['1.1', '1.2', '1.3', '1.4', '1.5'])
  })

  it('counts capacity in output_check entries, not rule files - a 3-setting rule fills a cap-of-3 chunk alone', () => {
    const rules = [
      generatableRule('1.1', 'macOS', [ruleEntry('a'), ruleEntry('b'), ruleEntry('c')]),
      generatableRule('1.2', 'macOS', [ruleEntry('d')]),
    ]

    const chunks = packChunks(rules, { maxRulesPerChunk: 3, maxBytesPerChunk: 1_000_000 })

    // 1.1 alone already uses all 3 slots (by output_check count, not by
    // being "one rule"), so 1.2 must start a new chunk rather than join it.
    expect(chunks).toHaveLength(2)
    expect(chunks[0].rules.map((rule) => rule.id)).toEqual(['1.1'])
    expect(chunks[1].rules.map((rule) => rule.id)).toEqual(['1.2'])
  })

  it('splits a section once the byte-size cap is exceeded, using real serialized size', () => {
    const bigValue = 'x'.repeat(200)
    const rules = Array.from({ length: 5 }, (_, index) => generatableRule(`1.${index + 1}`, 'macOS', [ruleEntry(`v${index}`, bigValue)]))

    const chunks = packChunks(rules, { maxRulesPerChunk: 1000, maxBytesPerChunk: 500 })

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      const byteLength = new TextEncoder().encode(JSON.stringify(chunk.ruleEntries)).length
      expect(byteLength).toBeLessThanOrEqual(500)
    }
  })

  it('throws a clear error when a single rule alone exceeds the per-chunk cap', () => {
    const entries = Array.from({ length: 5 }, (_, index) => ruleEntry(`v${index}`))
    const rules = [generatableRule('1.1', 'macOS', entries)]

    expect(() => packChunks(rules, { maxRulesPerChunk: 2, maxBytesPerChunk: 1_000_000 })).toThrow(/1\.1/)
  })

  it('throws a clear error when two rules in the same chunk declare the same SettingName', () => {
    const rules = [
      generatableRule('1.1', 'macOS', [ruleEntry('duplicate_var')]),
      generatableRule('1.2', 'macOS', [ruleEntry('duplicate_var')]),
    ]

    expect(() => packChunks(rules)).toThrow(/duplicate_var/)
  })
})
