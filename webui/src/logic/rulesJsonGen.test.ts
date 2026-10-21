import { describe, expect, it } from 'vitest'
import type { Rule } from '../types/library'
import type { RuleCheckPlan } from './checkPlan'
import { buildRuleEntry } from './rulesJsonGen'

const RULE = {
  id: 'mscp.pwpolicy_minimum_length_enforce',
  title: 'Require a Minimum Password Length of $ODV Characters',
  discussion: 'The macOS _MUST_ be configured to require a minimum of $ODV characters.\n\nSecond paragraph about $ODV.',
  source: { upstream_url: 'https://github.com/usnistgov/macos_security/blob/abc/rules/pwpolicy/pwpolicy_minimum_length_enforce.yaml' },
} as unknown as Rule

function plan(overrides: Partial<RuleCheckPlan> = {}): RuleCheckPlan {
  return {
    id: RULE.id,
    title: RULE.title,
    settingName: 'pwpolicy_minimum_length_enforce',
    architecture: null,
    reporting: 'raw',
    dataType: 'String',
    operand: 'true',
    branches: [],
    newerThan: '27',
    newerBranch: null,
    odvValue: 15,
    exportedOdv: null,
    ...overrides,
  }
}

describe('buildRuleEntry', () => {
  it('builds an IsEquals entry from the plan with the ODV shown in the title and first discussion paragraph', () => {
    expect(buildRuleEntry(plan(), RULE)).toEqual({
      SettingName: 'pwpolicy_minimum_length_enforce',
      Operator: 'IsEquals',
      DataType: 'String',
      Operand: 'true',
      MoreInfoUrl: 'https://github.com/usnistgov/macos_security/blob/abc/rules/pwpolicy/pwpolicy_minimum_length_enforce.yaml',
      RemediationStrings: [
        {
          Language: 'en_US',
          Title: 'Require a Minimum Password Length of 15 Characters',
          Description: 'The macOS _MUST_ be configured to require a minimum of 15 characters.',
        },
      ],
    })
  })

  it('carries Int64 and Boolean operands unchanged', () => {
    expect(buildRuleEntry(plan({ dataType: 'Int64', operand: 25 }), RULE)).toMatchObject({ DataType: 'Int64', Operand: 25 })
    expect(buildRuleEntry(plan({ reporting: 'boolean', dataType: 'Boolean', operand: true }), RULE)).toMatchObject({
      DataType: 'Boolean',
      Operand: true,
    })
  })

  it('shows a [value] placeholder when the plan has no ODV value', () => {
    const entry = buildRuleEntry(plan({ odvValue: null }), RULE)

    expect(entry.RemediationStrings[0].Title).toBe('Require a Minimum Password Length of [value] Characters')
  })
})
