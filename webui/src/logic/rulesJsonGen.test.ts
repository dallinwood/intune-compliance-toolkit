import { describe, expect, it } from 'vitest'
import { buildRuleEntriesForMethod, buildRuleEntry } from './rulesJsonGen'
import type { AuditMethod, OutputCheck } from '../types/rule-detail'

const BENCHMARK_CHECK: OutputCheck = {
  variable: 'cis_intune_win11_1_1_allow_cortana_above_lock',
  data_type: 'integer',
  operator: 'eq',
  value: 0,
  value_source: 'benchmark',
}

const ORG_DEFINED_CHECK: OutputCheck = {
  variable: 'cis_macos26_2_1_1_1_icloud_keychain_sync_allowed',
  data_type: 'boolean',
  operator: 'eq',
  value: null,
  value_source: 'organization_defined',
}

const RULE_SUMMARY = {
  title: "Ensure 'Allow Cortana Above Lock' is set to 'Block'",
  description: 'This policy setting determines whether or not the user can interact with Cortana using speech while the system is locked.',
  references: ['https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-abovelock#allowcortanaabovelock'],
}

describe('buildRuleEntry', () => {
  it('maps a benchmark-defined check to an Intune Rules[] entry', () => {
    const entry = buildRuleEntry(BENCHMARK_CHECK, RULE_SUMMARY, {})

    expect(entry).toEqual({
      SettingName: 'cis_intune_win11_1_1_allow_cortana_above_lock',
      Operator: 'IsEquals',
      DataType: 'Int64',
      Operand: 0,
      MoreInfoUrl: 'https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-abovelock#allowcortanaabovelock',
      RemediationStrings: [{ Language: 'en_US', Title: RULE_SUMMARY.title, Description: RULE_SUMMARY.description }],
    })
  })

  it('omits MoreInfoUrl when the rule has no references', () => {
    const entry = buildRuleEntry(BENCHMARK_CHECK, { ...RULE_SUMMARY, references: [] }, {})

    expect(entry.MoreInfoUrl).toBeUndefined()
  })

  it('resolves the operand from organizationDefinedValues for an organization-defined check', () => {
    const entry = buildRuleEntry(ORG_DEFINED_CHECK, RULE_SUMMARY, {
      cis_macos26_2_1_1_1_icloud_keychain_sync_allowed: false,
    })

    expect(entry.Operand).toBe(false)
  })

  it('throws when an organization-defined check has no value yet - generation must be blocked, not guess', () => {
    expect(() => buildRuleEntry(ORG_DEFINED_CHECK, RULE_SUMMARY, {})).toThrow()
  })

  it('throws for an operator Intune has no native equivalent for', () => {
    expect(() => buildRuleEntry({ ...BENCHMARK_CHECK, operator: 'contains' }, RULE_SUMMARY, {})).toThrow()
  })
})

describe('buildRuleEntriesForMethod', () => {
  it('collects one entry per output_check across all of a method\'s steps, in order', () => {
    const method: AuditMethod = {
      method_name: 'Registry Check',
      type: 'scripted',
      description: '...',
      steps: [
        { step_role: 'lookup', original_command: null, check_command: '...', check_command_verified: true, output_description: '', output_check: [] },
        {
          step_role: 'compliance_check',
          original_command: null,
          check_command: '...',
          check_command_verified: true,
          output_description: '',
          output_check: [BENCHMARK_CHECK],
        },
      ],
    }

    const entries = buildRuleEntriesForMethod(method, RULE_SUMMARY, {})

    expect(entries).toHaveLength(1)
    expect(entries[0].SettingName).toBe(BENCHMARK_CHECK.variable)
  })
})
