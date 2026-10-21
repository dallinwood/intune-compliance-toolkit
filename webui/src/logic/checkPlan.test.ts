import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CheckResult, Odv, Rule, RuleCheck } from '../types/library'
import { planRuleCheck, settingNameFor, type RuleCheckPlan } from './checkPlan'

const RULES_DIRECTORY = new URL('../../../baselines/mscp/rules/', import.meta.url)
const COVERED_VERSIONS = ['27.0', '26.0', '15.0']

function realRule(upstreamId: string): Rule {
  return JSON.parse(readFileSync(new URL(`${upstreamId}.json`, RULES_DIRECTORY), 'utf8')) as Rule
}

function check(shell: string | null, result: CheckResult | null): RuleCheck {
  return { shell, result, additional_info: null }
}

function inlineRule(overrides: Partial<Rule> = {}): Rule {
  const upstreamId = (overrides.id ?? 'mscp.example_rule').replace(/^mscp\./, '')
  return {
    schema_version: 3,
    id: `mscp.${upstreamId}`,
    platform: 'macOS',
    title: 'Example rule',
    discussion: 'First paragraph.\n\nSecond paragraph.',
    source: {
      name: 'mscp',
      release_tag: 'release_27.0',
      commit_sha: 'abc',
      upstream_rule_id: upstreamId,
      upstream_path: `src/mscp/data/rules/os/${upstreamId}.yaml`,
      upstream_url: `https://example.test/${upstreamId}.yaml`,
      license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', rights_holder: 'NIST', modified: true },
    },
    assessment: { status: 'automated', manual_reason: null },
    architecture: null,
    applicability: { '15.0': [], '26.0': [], '27.0': [] },
    tags: [],
    references: {},
    check: { default: check('echo PASS', { type: 'string', value: 'PASS' }), by_version: {} },
    odv: null,
    remediation: { default: { shell: null, additional_info: null }, by_version: {}, mobileconfig_info: null, mobileconfig_by_version: {}, ddm_info: null },
    ...overrides,
  }
}

function stringOdv(overrides: Partial<Odv> = {}): Odv {
  return { datatype: 'string', description: 'Example', validation: null, recommended: 'Recommended', by_benchmark: {}, ...overrides }
}

function expectPlan(result: ReturnType<typeof planRuleCheck>): RuleCheckPlan {
  if ('problem' in result) throw new Error(`Expected a plan, got problem: ${result.problem}`)
  return result
}

function expectProblem(result: ReturnType<typeof planRuleCheck>): string {
  if (!('problem' in result)) throw new Error('Expected a problem, got a plan')
  return result.problem
}

describe('settingNameFor', () => {
  it('uses the upstream id with every character outside [A-Za-z0-9_] replaced by _', () => {
    expect(settingNameFor(inlineRule({ id: 'mscp.os_mfa_network_non-priv' }))).toBe('os_mfa_network_non_priv')
    expect(settingNameFor(realRule('os_mfa_network_non-priv'))).toBe('os_mfa_network_non_priv')
  })
})

describe('planRuleCheck with real committed rules', () => {
  it('reports os_gatekeeper_enable raw as the String "PASS"', () => {
    const rule = realRule('os_gatekeeper_enable')
    const plan = expectPlan(planRuleCheck(rule, COVERED_VERSIONS, null))

    expect(plan).toMatchObject({
      id: 'mscp.os_gatekeeper_enable',
      title: 'Enable Gatekeeper',
      settingName: 'os_gatekeeper_enable',
      architecture: null,
      reporting: 'raw',
      dataType: 'String',
      operand: 'PASS',
      newerThan: '27',
      odvValue: null,
      exportedOdv: null,
    })
    expect(plan.branches).toEqual([
      { majors: ['15', '26', '27'], shell: rule.check!.default!.shell, expected: { type: 'string', value: 'PASS' } },
    ])
    expect(plan.newerBranch).toEqual({ shell: rule.check!.default!.shell, expected: { type: 'string', value: 'PASS' } })
  })

  it('reports os_tftpd_disable as boolean because its 15.0 override changes the result type', () => {
    const rule = realRule('os_tftpd_disable')
    const plan = expectPlan(planRuleCheck(rule, COVERED_VERSIONS, null))

    expect(plan.reporting).toBe('boolean')
    expect(plan.dataType).toBe('Boolean')
    expect(plan.operand).toBe(true)
    expect(plan.branches).toEqual([
      { majors: ['15'], shell: rule.check!.by_version['15.0'].shell, expected: { type: 'integer', value: 1 } },
      { majors: ['26', '27'], shell: rule.check!.default!.shell, expected: { type: 'string', value: 'PASS' } },
    ])
    expect(plan.newerBranch).toEqual({ shell: rule.check!.default!.shell, expected: { type: 'string', value: 'PASS' } })
  })

  it('substitutes the ODV into the integer result of audit_configure_capacity_notify', () => {
    const rule = realRule('audit_configure_capacity_notify')

    const recommendedPlan = expectPlan(planRuleCheck(rule, COVERED_VERSIONS, null))
    expect(recommendedPlan).toMatchObject({ reporting: 'raw', dataType: 'Int64', operand: 25, odvValue: 25, exportedOdv: null })
    expect(recommendedPlan.branches[0].expected).toEqual({ type: 'integer', value: 25 })

    const customPlan = expectPlan(planRuleCheck(rule, COVERED_VERSIONS, '40'))
    expect(customPlan).toMatchObject({ dataType: 'Int64', operand: 40, odvValue: 40 })
  })

  it('gives os_messages_app_disable_familycontrols no branch for 27 and a newer branch from 26', () => {
    const rule = realRule('os_messages_app_disable_familycontrols')
    const plan = expectPlan(planRuleCheck(rule, COVERED_VERSIONS, null))

    expect(plan.newerThan).toBe('27')
    expect(plan.branches.flatMap((branch) => branch.majors)).toEqual(['15', '26'])
    expect(plan.newerBranch).toEqual({ shell: rule.check!.by_version['26.0'].shell, expected: { type: 'string', value: 'true' } })
  })

  it('exports a variable-mode ODV and leaves $ODV in the shell for os_policy_banner_ssh_configure', () => {
    const rule = realRule('os_policy_banner_ssh_configure')
    const banner = "Authorised use only.\nIt's monitored."
    const plan = expectPlan(planRuleCheck(rule, COVERED_VERSIONS, banner))

    expect(plan.exportedOdv).toBe(banner)
    expect(plan.branches[0].shell).toBe(rule.check!.default!.shell)
    expect(plan.branches[0].shell).toContain('$ODV')
  })

  it('text-replaces the ODV into the shell of a text-mode rule', () => {
    const rule = realRule('pwpolicy_minimum_length_enforce')
    const plan = expectPlan(planRuleCheck(rule, COVERED_VERSIONS, 20))

    expect(plan.exportedOdv).toBeNull()
    for (const branch of plan.branches) {
      expect(branch.shell).not.toContain('$ODV')
      expect(branch.shell).toContain('20')
    }
  })

  it.each(['os_gatekeeper_rearm', 'os_firewall_log_enable'])('refuses %s, which mSCP maps to no macOS version', (upstreamId) => {
    expect(expectProblem(planRuleCheck(realRule(upstreamId), COVERED_VERSIONS, null))).toBe(
      'mSCP does not map this rule to any macOS version.',
    )
  })

  it('base64-encodes system_settings_loginwindow_loginwindowtext_enable with the trailing newline osascript prints', () => {
    const rule = realRule('system_settings_loginwindow_loginwindowtext_enable')
    const plan = expectPlan(planRuleCheck(rule, COVERED_VERSIONS, null))

    const encoded = Buffer.from('Center for Internet Security Test Message\n', 'utf8').toString('base64')
    expect(plan).toMatchObject({ reporting: 'raw', dataType: 'String', operand: encoded })
  })
})

describe('planRuleCheck with inline rules', () => {
  it('base64-encodes the UTF-8 of a substituted $ODV result', () => {
    const rule = inlineRule({
      check: { default: check('printf x | base64', { type: 'base64', value: '$ODV' }), by_version: {} },
      odv: stringOdv(),
    })
    const plan = expectPlan(planRuleCheck(rule, COVERED_VERSIONS, 'Café-1'))

    expect(plan.branches[0].expected).toEqual({ type: 'base64', value: Buffer.from('Café-1\n', 'utf8').toString('base64') })
    expect(plan.operand).toBe(Buffer.from('Café-1\n', 'utf8').toString('base64'))
  })

  it('uses the recommended ODV when none is selected', () => {
    const rule = inlineRule({
      check: { default: check('echo $ODV', { type: 'string', value: '$ODV' }), by_version: {} },
      odv: stringOdv(),
    })
    const plan = expectPlan(planRuleCheck(rule, COVERED_VERSIONS, null))

    expect(plan.operand).toBe('Recommended')
    expect(plan.branches[0].shell).toBe('echo Recommended')
  })

  it('refuses a rule whose ODV is missing', () => {
    const rule = inlineRule({
      check: { default: check('echo $ODV', { type: 'string', value: '$ODV' }), by_version: {} },
      odv: stringOdv({ recommended: null as unknown as string }),
    })

    expect(expectProblem(planRuleCheck(rule, COVERED_VERSIONS, null))).toBe('This rule needs an organization-defined value.')
  })

  it('refuses an invalid stored ODV instead of falling back to the recommended one', () => {
    const rule = inlineRule({
      check: { default: check('echo $ODV', { type: 'string', value: '$ODV' }), by_version: {} },
      odv: stringOdv(),
    })

    expect(expectProblem(planRuleCheck(rule, COVERED_VERSIONS, '$(reboot)'))).toBe(
      'The organization-defined value is invalid: Value must not contain "$(".',
    )
  })

  it('refuses a number ODV beyond the safe integer range', () => {
    const rule = inlineRule({
      check: { default: check('echo 1', { type: 'integer', value: '$ODV' }), by_version: {} },
      odv: { datatype: 'number', description: 'n', validation: null, recommended: 5, by_benchmark: {} },
    })

    expect(expectProblem(planRuleCheck(rule, COVERED_VERSIONS, '99999999999999999999'))).toMatch(/^The organization-defined value is invalid: /)
  })

  it('refuses a manual rule', () => {
    const rule = inlineRule({ assessment: { status: 'manual', manual_reason: 'manual' } })

    expect(expectProblem(planRuleCheck(rule, COVERED_VERSIONS, null))).toBe('This rule is assessed manually.')
  })

  it('refuses a rule whose listed version resolves to no check', () => {
    const rule = inlineRule({ check: { default: null, by_version: { '15.0': check('echo PASS', { type: 'string', value: 'PASS' }) } } })

    expect(expectProblem(planRuleCheck(rule, COVERED_VERSIONS, null))).toBe('mSCP has no check for macOS 26.0.')
  })

  it('refuses a rule whose listed version resolves to a check with a null result', () => {
    const rule = inlineRule({ check: { default: check('echo PASS', null), by_version: {} } })

    expect(expectProblem(planRuleCheck(rule, COVERED_VERSIONS, null))).toBe('mSCP gives no expected result for macOS 15.0.')
  })

  it('refuses $ODV in a rule that defines no ODV', () => {
    const rule = inlineRule({ check: { default: check('echo $ODV', { type: 'string', value: 'PASS' }), by_version: {} } })

    expect(expectProblem(planRuleCheck(rule, COVERED_VERSIONS, null))).toBe('This rule uses $ODV but defines no organization-defined value.')
  })

  it('carries the rule architecture', () => {
    const plan = expectPlan(planRuleCheck(inlineRule({ architecture: 'arm64' }), COVERED_VERSIONS, null))

    expect(plan.architecture).toBe('arm64')
  })

  it('takes newerThan from the covered versions, not the rule, and the newer branch from the rule\'s highest version', () => {
    const rule = inlineRule({
      applicability: { '15.0': [] },
      check: { default: check('echo PASS', { type: 'string', value: 'PASS' }), by_version: {} },
    })
    const plan = expectPlan(planRuleCheck(rule, ['9.0', '26.0', '15.0'], null))

    expect(plan.newerThan).toBe('26')
    expect(plan.branches).toEqual([{ majors: ['15'], shell: 'echo PASS', expected: { type: 'string', value: 'PASS' } }])
    expect(plan.newerBranch).toEqual({ shell: 'echo PASS', expected: { type: 'string', value: 'PASS' } })
  })

  it('reports boolean when only the expected value differs between versions', () => {
    const rule = inlineRule({
      check: {
        default: check('echo 1', { type: 'integer', value: 1 }),
        by_version: { '15.0': check('echo 1', { type: 'integer', value: 0 }) },
      },
    })
    const plan = expectPlan(planRuleCheck(rule, COVERED_VERSIONS, null))

    expect(plan.reporting).toBe('boolean')
  })
})
