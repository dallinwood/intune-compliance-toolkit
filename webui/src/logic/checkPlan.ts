import type { Architecture, CheckResult, Rule, RuleCheck, TargetCheck } from '../types/library'
import { versionsForTarget } from './applicability'
import type { IntuneDataType } from './operatorMap'
import {
  canonicalOdvValue,
  effectiveOdvValue,
  odvPlaceholder,
  odvPlaceholderNames,
  odvSubstitutionMode,
  substituteOdvs,
  validateOdvValue,
} from './odv'
import type { OdvValues } from './selectionEntry'

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
  // The canonical effective value of every ODV, for display (titles, descriptions).
  odvValues: OdvValues
  // Only the variable-mode ODVs: the script exports each as ODV_<name> before
  // running the check, whose shell then still contains $ODV_<name> on purpose.
  exportedOdvs: Record<string, string>
}

// The one target the generator writes scripts for; applicability entries for
// any other target are ignored here.
export const GENERATED_TARGET = 'macOS'

// The only check the generator reads; checks for other targets are shown in
// the details but never scripted.
export function generatedTargetCheck(rule: Pick<Rule, 'check'>): TargetCheck | null {
  return rule.check?.[GENERATED_TARGET] ?? null
}

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

function resolveExpected(result: CheckResult, odvValues: OdvValues): ExpectedResult | { problem: string } {
  const substituted = typeof result.value === 'string' ? substituteOdvs(result.value, odvValues) : result.value

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

function generatedCheckTexts(rule: Rule): string[] {
  const targetCheck = generatedTargetCheck(rule)
  const checks = [targetCheck?.default, ...Object.values(targetCheck?.by_version ?? {})]
  return checks.flatMap((check) => [check?.shell, check?.result?.value]).filter((text): text is string => typeof text === 'string')
}

interface ResolvedOdvs {
  values: OdvValues
  // The values the script exports instead of text-replacing.
  exported: Record<string, string>
  // The values text-replaced into each check shell.
  textValues: OdvValues
}

function resolveOdvs(rule: Rule, selected: OdvValues): ResolvedOdvs | { problem: string } {
  const declaredNames = new Set(rule.odvs.map((odv) => odv.name))
  for (const name of generatedCheckTexts(rule).flatMap(odvPlaceholderNames)) {
    if (!declaredNames.has(name)) {
      return { problem: `This rule uses ${odvPlaceholder(name)} but defines no organization-defined value named ${name}.` }
    }
  }

  const resolved: ResolvedOdvs = { values: {}, exported: {}, textValues: {} }
  for (const odv of rule.odvs) {
    const mode = odvSubstitutionMode(rule, odv)
    const storedValue = Object.hasOwn(selected, odv.name) ? selected[odv.name] : null
    const effective = effectiveOdvValue(odv, storedValue)
    const label = rule.odvs.length > 1 ? ` "${odv.name}"` : ''
    if (effective === null) return { problem: `This rule needs an organization-defined value${label}.` }

    const canonical = canonicalOdvValue(odv, effective)
    const invalidReason = validateOdvValue(odv, canonical, mode, rule.id)
    if (invalidReason) return { problem: `The organization-defined value${label} is invalid: ${invalidReason}` }

    resolved.values[odv.name] = canonical
    if (mode === 'variable') resolved.exported[odv.name] = String(canonical)
    if (mode === 'text') resolved.textValues[odv.name] = canonical
  }
  return resolved
}

interface VersionCheck {
  major: string
  shell: string
  expected: ExpectedResult
}

function resolveVersionCheck(rule: Rule, version: string, odvs: ResolvedOdvs): VersionCheck | { problem: string } {
  const targetCheck = generatedTargetCheck(rule)
  const check: RuleCheck | null = targetCheck?.by_version[version] ?? targetCheck?.default ?? null
  if (!check?.shell) return { problem: `mSCP has no check for macOS ${version}.` }
  if (!check.result) return { problem: `mSCP gives no expected result for macOS ${version}.` }

  const expected = resolveExpected(check.result, odvs.values)
  if ('problem' in expected) return expected

  const shell = substituteOdvs(check.shell, odvs.textValues)
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
  selected: OdvValues,
): RuleCheckPlanResult {
  if (rule.assessment.status !== 'automated') return { problem: 'This rule is assessed manually.' }

  const listedVersions = versionsForTarget(rule.applicability, GENERATED_TARGET).sort(byMajorAscending)
  if (listedVersions.length === 0) return { problem: 'mSCP does not map this rule to any macOS version.' }

  const odvs = resolveOdvs(rule, selected)
  if ('problem' in odvs) return odvs

  const versionChecks: VersionCheck[] = []
  for (const version of listedVersions) {
    const versionCheck = resolveVersionCheck(rule, version, odvs)
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
    odvValues: odvs.values,
    exportedOdvs: odvs.exported,
  }
}
