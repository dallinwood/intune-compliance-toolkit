// Shared by the generator tests only; nothing in the app imports it.
import type { Applicability, BenchmarkMembership, CheckResult, Odv, Rule, RuleCheck, RuleChecks } from '../types/library'
import { parseVersionKey } from './applicability'

export function ruleCheck(shell: string | null, result: CheckResult | null, additionalInfo: string | null = null): RuleCheck {
  return { shell, result, additional_info: additionalInfo }
}

// Test shorthand for the only check shape mSCP produces: a bash check for macOS.
export function macosCheck(defaultCheck: RuleCheck | null, byVersion: Record<string, RuleCheck> = {}): RuleChecks {
  return { macOS: { language: 'bash', default: defaultCheck, by_version: byVersion } }
}

// Test shorthand: { 'macOS 27.0': [...] } as the entry list the library stores.
export function applicabilityOfVersions(membershipsByVersionKey: Record<string, BenchmarkMembership[]>): Applicability {
  return Object.entries(membershipsByVersionKey).map(([key, benchmarks]) => ({ ...parseVersionKey(key), benchmarks }))
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
    schema_version: 5,
    id: `mscp.${upstreamId}`,
    title: `Rule ${upstreamId}`,
    discussion: 'First paragraph.\n\nSecond paragraph.',
    discussion_format: 'asciidoc',
    section_path: [section],
    source: {
      name: 'mscp',
      release_tag: releaseTag,
      commit_sha: 'abc',
      upstream_rule_id: upstreamId,
      upstream_path: `rules/${section}/${upstreamId}.yaml`,
      upstream_url: `https://example.test/${upstreamId}.yaml`,
      upstream_revision: null,
      upstream_updated: null,
      license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', rights_holder: 'NIST', modified: true },
    },
    assessment: { status: 'automated', manual_reason: null },
    architecture: null,
    applicability: applicabilityOfVersions({ 'macOS 15.0': [], 'macOS 26.0': [], 'macOS 27.0': [] }),
    tags: [],
    references: {},
    check: macosCheck(ruleCheck('echo PASS', { type: 'string', value: 'PASS' })),
    odv: null,
    remediation: null,
    ...overrides,
  }
}

export function numberOdv(overrides: Partial<Odv> = {}): Odv {
  return { datatype: 'number', description: 'Example length', validation: { min: 1 }, recommended: 6, by_benchmark: {}, ...overrides }
}
