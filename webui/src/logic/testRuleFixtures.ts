// Shared by the generator tests only; nothing in the app imports it.
import type { CheckResult, Odv, Rule, RuleCheck } from '../types/library'

export function ruleCheck(shell: string | null, result: CheckResult | null, additionalInfo: string | null = null): RuleCheck {
  return { shell, result, additional_info: additionalInfo }
}

export interface InlineRuleOptions {
  upstreamId?: string
  section?: string
  releaseTag?: string
  overrides?: Partial<Rule>
}

export function inlineRule({
  upstreamId = 'os_example_rule',
  section = 'os',
  releaseTag = 'release_27.0',
  overrides = {},
}: InlineRuleOptions = {}): Rule {
  return {
    schema_version: 3,
    id: `mscp.${upstreamId}`,
    platform: 'macOS',
    title: `Rule ${upstreamId}`,
    discussion: 'First paragraph.\n\nSecond paragraph.',
    source: {
      name: 'mscp',
      release_tag: releaseTag,
      commit_sha: 'abc',
      upstream_rule_id: upstreamId,
      upstream_path: `rules/${section}/${upstreamId}.yaml`,
      upstream_url: `https://example.test/${upstreamId}.yaml`,
      license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', rights_holder: 'NIST', modified: true },
    },
    assessment: { status: 'automated', manual_reason: null },
    architecture: null,
    applicability: { '15.0': [], '26.0': [], '27.0': [] },
    tags: [],
    references: {},
    check: { default: ruleCheck('echo PASS', { type: 'string', value: 'PASS' }), by_version: {} },
    odv: null,
    remediation: {
      default: { shell: null, additional_info: null },
      by_version: {},
      mobileconfig_info: null,
      mobileconfig_by_version: {},
      ddm_info: null,
    },
    ...overrides,
  }
}

export function numberOdv(overrides: Partial<Odv> = {}): Odv {
  return { datatype: 'number', description: 'Example length', validation: { min: 1 }, recommended: 6, by_benchmark: {}, ...overrides }
}
