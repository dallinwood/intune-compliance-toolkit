import type { Architecture, CheckResult, Rule, RuleCheck } from '../types/library'
import { versionsForTarget } from './applicability'
import type { IntuneDataType } from './operatorMap'
import {
  canonicalOdvValue,
  containsOdvPlaceholder,
  effectiveOdvValue,
  odvSubstitutionMode,
  substituteOdv,
  validateOdvValue,
  type OdvSubstitutionMode,
} from './odv'
import type { OrgDefinedValue } from './selectionEntry'

export interface ExpectedResult {
  type: CheckResult['type']
  value: number | string
}

export interface CheckBranch {
  majors: string[]
  shell: string
  expected: ExpectedResult
}

export interface NewerBranch {
  shell: string
  expected: ExpectedResult
}

export interface RuleCheckPlan {
  id: string
  title: string
  settingName: string
  architecture: Architecture
  reporting: 'raw' | 'boolean'
  dataType: IntuneDataType
  operand: number | string | boolean
  branches: CheckBranch[]
  newerThan: string
  newerBranch: NewerBranch | null
  // The canonical effective ODV, for display (titles, descriptions).
  odvValue: OrgDefinedValue | null
  // Set only for variable-mode rules: the script exports it as ODV before
  // running the check, whose shell then still contains $ODV on purpose.
  exportedOdv: string | null
}

// The one target the generator writes scripts for; applicability entries for
// any other target are ignored here.
export const GENERATED_TARGET = 'macOS'

export type RuleCheckPlanResult = RuleCheckPlan | { problem: string }

const NON_SETTING_NAME_CHARACTER = /[^A-Za-z0-9_]/g
const INTEGER_TEXT = /^-?[0-9]+$/

export function settingNameFor(rule: Rule): string {
  return rule.source.upstream_rule_id.replace(NON_SETTING_NAME_CHARACTER, '_')
}

function majorOf(version: string): string {
  return version.split('.')[0]
}

function byMajorAscending(left: string, right: string): number {
  return Number(majorOf(left)) - Number(majorOf(right))
}

// mSCP's check script pipes osascript into base64, and osascript ends its
// output with a newline, so the device reports base64 of the value plus "\n".
// mSCP 1.x encoded exactly that (scripts/generate_guidance.py:1309 on the
// sequoia branch: f"{result['base64']}\n"). mSCP 2.0's own encoder
// (macsecurityrule.py:312) is unreachable for string values, so it is no guide.
function base64ExpectedValue(text: string): string {
  const bytes = new TextEncoder().encode(`${text}\n`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function resolveExpected(result: CheckResult, odvValue: OrgDefinedValue | null): ExpectedResult | { problem: string } {
  const substituted =
    typeof result.value === 'string' && odvValue !== null ? substituteOdv(result.value, odvValue) : result.value

  if (result.type === 'integer') {
    if (typeof substituted === 'number' && Number.isSafeInteger(substituted)) return { type: 'integer', value: substituted }
    if (typeof substituted === 'string' && INTEGER_TEXT.test(substituted) && Number.isSafeInteger(Number(substituted))) {
      return { type: 'integer', value: Number(substituted) }
    }
    return { problem: `mSCP expects an integer result, but the expected value is ${JSON.stringify(substituted)}.` }
  }
  if (result.type === 'base64') return { type: 'base64', value: base64ExpectedValue(String(substituted)) }
  return { type: 'string', value: String(substituted) }
}

function sameExpected(left: ExpectedResult, right: ExpectedResult): boolean {
  return left.type === right.type && left.value === right.value
}

function ruleUsesOdv(rule: Rule): boolean {
  const checks = [rule.check?.default, ...Object.values(rule.check?.by_version ?? {})]
  return checks.some(
    (check) =>
      (check?.shell != null && containsOdvPlaceholder(check.shell)) ||
      (typeof check?.result?.value === 'string' && containsOdvPlaceholder(check.result.value)),
  )
}

interface ResolvedOdv {
  value: OrgDefinedValue | null
  mode: OdvSubstitutionMode
}

function resolveOdv(rule: Rule, selectedValue: OrgDefinedValue | null): ResolvedOdv | { problem: string } {
  if (!rule.odv) {
    if (ruleUsesOdv(rule)) return { problem: 'This rule uses $ODV but defines no organization-defined value.' }
    return { value: null, mode: 'none' }
  }

  const mode = odvSubstitutionMode(rule)
  const effective = effectiveOdvValue(rule.odv, selectedValue)
  if (effective === null) return { problem: 'This rule needs an organization-defined value.' }

  const canonical = canonicalOdvValue(rule.odv, effective)
  const invalidReason = validateOdvValue(rule.odv, canonical, mode, rule.id)
  if (invalidReason) return { problem: `The organization-defined value is invalid: ${invalidReason}` }
  return { value: canonical, mode }
}

interface VersionCheck {
  major: string
  shell: string
  expected: ExpectedResult
}

function resolveVersionCheck(rule: Rule, version: string, odv: ResolvedOdv): VersionCheck | { problem: string } {
  const check: RuleCheck | null = rule.check?.by_version[version] ?? rule.check?.default ?? null
  if (!check?.shell) return { problem: `mSCP has no check for macOS ${version}.` }
  if (!check.result) return { problem: `mSCP gives no expected result for macOS ${version}.` }

  const expected = resolveExpected(check.result, odv.value)
  if ('problem' in expected) return expected

  const shell = odv.mode === 'text' && odv.value !== null ? substituteOdv(check.shell, odv.value) : check.shell
  return { major: majorOf(version), shell, expected }
}

function groupIntoBranches(versionChecks: VersionCheck[]): CheckBranch[] {
  const branches: CheckBranch[] = []
  for (const versionCheck of versionChecks) {
    const matchingBranch = branches.find(
      (branch) => branch.shell === versionCheck.shell && sameExpected(branch.expected, versionCheck.expected),
    )
    if (matchingBranch) matchingBranch.majors.push(versionCheck.major)
    else branches.push({ majors: [versionCheck.major], shell: versionCheck.shell, expected: versionCheck.expected })
  }
  return branches
}

function intuneComparison(expected: ExpectedResult): { dataType: IntuneDataType; operand: number | string } {
  if (expected.type === 'integer') return { dataType: 'Int64', operand: expected.value }
  return { dataType: 'String', operand: String(expected.value) }
}

export function planRuleCheck(
  rule: Rule,
  coveredVersions: string[],
  odvValue: OrgDefinedValue | null,
): RuleCheckPlanResult {
  if (rule.assessment.status !== 'automated') return { problem: 'This rule is assessed manually.' }

  const listedVersions = versionsForTarget(rule.applicability, GENERATED_TARGET).sort(byMajorAscending)
  if (listedVersions.length === 0) return { problem: 'mSCP does not map this rule to any macOS version.' }

  const odv = resolveOdv(rule, odvValue)
  if ('problem' in odv) return odv

  const versionChecks: VersionCheck[] = []
  for (const version of listedVersions) {
    const versionCheck = resolveVersionCheck(rule, version, odv)
    if ('problem' in versionCheck) return versionCheck
    const sameMajor = versionChecks.find((existing) => existing.major === versionCheck.major)
    if (sameMajor) {
      if (sameMajor.shell !== versionCheck.shell || !sameExpected(sameMajor.expected, versionCheck.expected)) {
        return { problem: `mSCP lists more than one different check for macOS ${versionCheck.major}.` }
      }
      continue
    }
    versionChecks.push(versionCheck)
  }

  const branches = groupIntoBranches(versionChecks)
  const highestListed = versionChecks[versionChecks.length - 1]
  const newerBranch: NewerBranch = { shell: highestListed.shell, expected: highestListed.expected }
  const coveredMajors = [...coveredVersions, ...listedVersions].map(majorOf)
  const newerThan = String(Math.max(...coveredMajors.map(Number)))

  const allExpected = [...branches.map((branch) => branch.expected), newerBranch.expected]
  const isRaw = allExpected.every((expected) => sameExpected(expected, allExpected[0]))
  const comparison = isRaw
    ? { reporting: 'raw' as const, ...intuneComparison(allExpected[0]) }
    : { reporting: 'boolean' as const, dataType: 'Boolean' as const, operand: true }

  return {
    id: rule.id,
    title: rule.title,
    settingName: settingNameFor(rule),
    architecture: rule.architecture,
    ...comparison,
    branches,
    newerThan,
    newerBranch,
    odvValue: odv.value,
    exportedOdv: odv.mode === 'variable' && odv.value !== null ? String(odv.value) : null,
  }
}
