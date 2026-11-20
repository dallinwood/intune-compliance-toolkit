import type { Odv, RegistrySetting, Rule } from '../types/library'
import { generatedCheckItem } from './checkPlan'
import type { OdvValues, OrgDefinedValue } from './selectionEntry'
import { termLabel, type VocabularyIndex } from './vocabulary'

export type OdvSubstitutionMode = 'none' | 'variable' | 'text'

interface DeniedSequence {
  sequence: string
  description: string
}

const CARRIAGE_RETURN: DeniedSequence = { sequence: '\r', description: 'a carriage return' }
const NUL: DeniedSequence = { sequence: '\0', description: 'a NUL character' }
const SINGLE_QUOTE: DeniedSequence = { sequence: "'", description: 'a single quote' }
const DOUBLE_QUOTE: DeniedSequence = { sequence: '"', description: 'a double quote' }
const BACKTICK: DeniedSequence = { sequence: '`', description: 'a backtick' }
const BACKSLASH: DeniedSequence = { sequence: '\\', description: 'a backslash' }
const NEWLINE: DeniedSequence = { sequence: '\n', description: 'a newline' }
const DOLLAR: DeniedSequence = { sequence: '$', description: 'a dollar sign' }
const COMMAND_SUBSTITUTION: DeniedSequence = { sequence: '$(', description: '"$("' }
const PARAMETER_EXPANSION: DeniedSequence = { sequence: '${', description: '"${"' }
// PowerShell also opens and closes strings with these typographic quotes.
const TYPOGRAPHIC_SINGLE_QUOTES: DeniedSequence[] = ['\u2018', '\u2019', '\u201a', '\u201b'].map((sequence) => ({
  sequence,
  description: 'a typographic single quote',
}))
const TYPOGRAPHIC_DOUBLE_QUOTES: DeniedSequence[] = ['\u201c', '\u201d', '\u201e'].map((sequence) => ({
  sequence,
  description: 'a typographic double quote',
}))

const ALWAYS_DENIED: DeniedSequence[] = [CARRIAGE_RETURN, NUL]
const TEXT_MODE_DENIED: DeniedSequence[] = [
  SINGLE_QUOTE,
  DOUBLE_QUOTE,
  BACKTICK,
  BACKSLASH,
  NEWLINE,
  COMMAND_SUBSTITUTION,
  PARAMETER_EXPANSION,
]

const INTEGER_PATTERN = /^-?[0-9]+$/
const UNQUOTED_STRING_PATTERN = /^[A-Za-z0-9._:+-]+$/
const UNSAFE_REGEX_CHARACTER_PATTERN = /[\s;|&<>]/
const UNSAFE_REGEX_DOLLAR_PATTERN = /\$[A-Za-z_{(]/
const ODV_PLACEHOLDER_PREFIX = '$ODV'
// A whole placeholder: the name is read greedily, so $ODV_a never matches
// inside $ODV_ab, and it must not run on into another name character, so
// $ODV_vX is malformed rather than $ODV_v followed by X. The same grammar as
// tools/odv_placeholders.py, pinned by
// tests/fixtures/odv_placeholders/grammar_cases.json.
const ODV_PLACEHOLDER_PATTERN = /\$ODV_([a-z][a-z0-9_]*)(?![A-Za-z0-9_])/g
const WHOLE_ODV_PLACEHOLDER_PATTERN = /^\$ODV_[a-z][a-z0-9_]*$/
// Every $ODV occurrence, well formed or not, with the name characters after it.
const ODV_OCCURRENCE_PATTERN = /\$ODV[A-Za-z0-9_]*/g

// Beyond CR and NUL (always denied), what may not sit inside each quoting.
const QUOTED_DISPLAY_DENIED: Readonly<Record<'single' | 'double', DeniedSequence[]>> = {
  single: [SINGLE_QUOTE, ...TYPOGRAPHIC_SINGLE_QUOTES, NEWLINE],
  double: [DOUBLE_QUOTE, ...TYPOGRAPHIC_DOUBLE_QUOTES, BACKTICK, DOLLAR, BACKSLASH, NEWLINE],
}

export interface OdvRuleValueCheck {
  isValid: (value: string) => boolean
  requirement: string
}

// The admin group rule's pattern may have exactly this shape and nothing else:
// optional ^, one or more names separated by |, optionally wrapped in one pair
// of parentheses, optional $. A name is made of plain account name characters,
// "." (any one character) and "\." (a literal dot). Allowing only this keeps
// out everything grep -E reads in a way JavaScript does not (brackets with
// collating symbols, repetition, lazy forms, other escapes).
const ACCOUNT_NAME = String.raw`(?:[A-Za-z0-9_-]|\\\.|\.)+`
const ACCOUNT_NAMES = `${ACCOUNT_NAME}(?:\\|${ACCOUNT_NAME})*`
const ACCOUNT_PATTERN_SHAPE = new RegExp(`^\\^?(?:\\(${ACCOUNT_NAMES}\\)|${ACCOUNT_NAMES})\\$?$`)
// macOS account names are short and plain; this one is deliberately not a name anyone would give.
const SENTINEL_NON_ACCOUNT_NAME = 'zz-not-an-account-9'

// The check runs `grep -vE "$ODV_value"` inside found=$(...), so a pattern that grep
// rejects prints nothing, and one that matches every account removes them all;
// either way the check reports 0 (compliant).
export function isPlainAccountPattern(value: string): boolean {
  // A leading hyphen would be read by grep as an option.
  if (value.startsWith('-') || !ACCOUNT_PATTERN_SHAPE.test(value)) return false
  let pattern: RegExp
  try {
    pattern = new RegExp(value)
  } catch {
    return false
  }
  // The shape cannot match nothing, but dots can match everything: a pattern
  // such as "..." matches every name of three characters or more.
  return !pattern.test('') && !pattern.test(SENTINEL_NON_ACCOUNT_NAME)
}

// Keyed `${ruleId}:${odvName}`.
export const ODV_RULE_VALUE_CHECKS: Readonly<Record<string, OdvRuleValueCheck>> = {
  // `date -v -$ODV_value` needs BSD date's number-plus-unit form; on anything else it prints nothing and the check passes.
  'mscp.system_settings_softwareupdate_current:value': {
    isValid: (value) => /^[0-9]+[ymwdHMS]$/.test(value),
    requirement: 'Value must be a whole number followed by one unit letter (y, m, w, d, H, M or S), for example 30d.',
  },
  'mscp.system_settings_admin_group_membership_defined:value': {
    isValid: isPlainAccountPattern,
    requirement:
      'Use account names separated by |, optionally wrapped as ^(...)$, for example ^(admin|jdoe)$. A dot matches any one character. Brackets, repetition symbols such as * and ?, and other backslash escapes are not allowed, so the check can never silently pass.',
  },
}

// Keyed `${ruleId}:${odvName}`. Entries are hand-reviewed check shells where the placeholder is only ever expanded as a double-quoted variable, so the generator can define ODV_<name> as a variable instead of text-replacing.
export const ODV_VARIABLE_ALLOWLIST: Readonly<Record<string, string>> = {
  'mscp.os_policy_banner_ssh_configure:value': 'bannerText="$ODV_value"\ntest "$(cat /etc/banner)" = "$bannerText" && echo "1" || echo "0"',
  'mscp.system_settings_admin_group_membership_defined:value': `found=$(for u in $(/usr/bin/dscl . -list /Users UniqueID | /usr/bin/awk '$2 > 500 {print $1}'); do
  /usr/bin/dsmemberutil checkmembership -U "$u" -G admin 2> /dev/null | /usr/bin/grep -q "is a member" && echo "$u"
done | /usr/bin/grep -vE "$ODV_value")

if [[ -z "$found" ]]; then
  echo "0"
else
  echo "Undocumented admin accounts found: $found"
fi`,
}

export function odvPlaceholder(name: string): string {
  return `${ODV_PLACEHOLDER_PREFIX}_${name}`
}

// Every ODV name a text uses, in order of first use.
export function odvPlaceholderNames(text: string): string[] {
  const names = new Set<string>()
  for (const match of text.matchAll(ODV_PLACEHOLDER_PATTERN)) names.add(match[1])
  return Array.from(names)
}

// Whether a text has a $ODV occurrence that is not exactly $ODV_<name>, which
// no value ever replaces.
export function hasMalformedOdvPlaceholder(text: string): boolean {
  return Array.from(text.matchAll(ODV_OCCURRENCE_PATTERN)).some(([occurrence]) => !WHOLE_ODV_PLACEHOLDER_PATTERN.test(occurrence))
}

function odvKey(ruleId: string, odvName: string): string {
  return `${ruleId}:${odvName}`
}

// How this ODV reaches the generated macOS check: text-replaced into the
// shell, exported as a variable, or not in the shell at all.
export function odvSubstitutionMode(rule: Rule, odv: Odv): OdvSubstitutionMode {
  const checkItem = generatedCheckItem(rule)
  const shellTexts = [checkItem?.default?.shell, ...Object.values(checkItem?.by_version ?? {}).map((check) => check.shell)]
  const shellsWithOdv = shellTexts.filter(
    (shellText): shellText is string => !!shellText && odvPlaceholderNames(shellText).includes(odv.name),
  )
  if (shellsWithOdv.length === 0) return 'none'

  const allowlistedShell = ODV_VARIABLE_ALLOWLIST[odvKey(rule.id, odv.name)]
  const isAllowlisted = allowlistedShell !== undefined && shellsWithOdv.every((shellText) => shellText === allowlistedShell)
  return isAllowlisted ? 'variable' : 'text'
}

function compileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern)
  } catch {
    return null
  }
}

// The value to store for an input: number ODVs become real JS numbers so
// '007' and 7 are the same value everywhere downstream.
export function canonicalOdvValue(odv: Odv, value: OrgDefinedValue): OrgDefinedValue {
  if (odv.datatype !== 'number') return value
  const text = String(value)
  return INTEGER_PATTERN.test(text) ? Number(text) : value
}

export function effectiveOdvValue(odv: Odv | null, selected: OrgDefinedValue | null): OrgDefinedValue | null {
  if (!odv) return null
  return selected ?? odv.recommended ?? null
}

function validateAgainstDatatype(odv: Odv, text: string): string | null {
  const validation = odv.validation

  if (odv.datatype === 'number') {
    if (!INTEGER_PATTERN.test(text)) return 'Value must be a whole number.'
    const numericValue = Number(text)
    if (!Number.isSafeInteger(numericValue)) {
      return `Value must be a whole number between ${Number.MIN_SAFE_INTEGER} and ${Number.MAX_SAFE_INTEGER}.`
    }
    if (validation?.min !== undefined && numericValue < validation.min) return `Value must be at least ${validation.min}.`
    if (validation?.max !== undefined && numericValue > validation.max) return `Value must be at most ${validation.max}.`
    return null
  }

  if (odv.datatype === 'enum') {
    const allowed = validation?.enumValues ?? []
    return allowed.includes(text) ? null : `Value must be one of: ${allowed.join(', ')}.`
  }

  if (odv.datatype === 'regex' && !compileRegex(text)) return 'Value must be a valid regular expression.'

  if (validation?.regex !== undefined) {
    const requiredPattern = compileRegex(validation.regex)
    if (!requiredPattern) return 'This rule defines a validation pattern that is not a valid regular expression.'
    if (!requiredPattern.test(text)) return `Value must match the pattern ${validation.regex}.`
  }
  return null
}

// Returns null when the value is acceptable, otherwise a human-readable
// reason. Datatype rules run first, then any rule-specific pattern, then the
// extra rules for values that are text-replaced into the shell.
export function validateOdvValue(
  odv: Odv,
  value: OrgDefinedValue,
  mode: OdvSubstitutionMode,
  ruleId: string,
): string | null {
  const text = String(value)
  if (text.trim() === '') return 'Value must not be empty.'

  const datatypeProblem = validateAgainstDatatype(odv, text)
  if (datatypeProblem) return datatypeProblem

  const ruleValueCheck = ODV_RULE_VALUE_CHECKS[odvKey(ruleId, odv.name)]
  if (ruleValueCheck && !ruleValueCheck.isValid(text)) return ruleValueCheck.requirement

  for (const { sequence, description } of ALWAYS_DENIED) {
    if (text.includes(sequence)) return `Value must not contain ${description}.`
  }
  if (mode !== 'text') return null

  for (const { sequence, description } of TEXT_MODE_DENIED) {
    if (text.includes(sequence)) return `Value must not contain ${description}.`
  }
  if (odv.datatype === 'string' && !UNQUOTED_STRING_PATTERN.test(text)) {
    return 'Value may only contain letters, digits and . _ : + - characters.'
  }
  if (
    odv.datatype === 'regex' &&
    (UNSAFE_REGEX_CHARACTER_PATTERN.test(text) || UNSAFE_REGEX_DOLLAR_PATTERN.test(text))
  ) {
    return 'Value must not contain whitespace, ; | & < >, or a $ followed by a name.'
  }
  return null
}

// Plain text replacement of every placeholder whose name has a value, in one
// pass so a value containing a placeholder is never replaced again. A name
// without a value becomes `missing` when given, and otherwise stays as it is.
// A replacer function keeps "$&" and similar sequences in the value from being
// interpreted.
export function substituteOdvs(text: string, values: Partial<OdvValues>, missing?: string): string {
  return text.replaceAll(ODV_PLACEHOLDER_PATTERN, (placeholder, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined
    if (value !== undefined) return String(value)
    return missing ?? placeholder
  })
}

export function displayWithOdvs(text: string, values: Partial<OdvValues>): string {
  return substituteOdvs(text, values, '[value]')
}

export interface CodeOdvValues {
  // For inline check and remediation shells and their shell_file scripts,
  // whose quoting CI verifies: a quoted ODV's value only has to stay inside
  // its quotes.
  verifiedShell: Partial<OdvValues>
  // For any other code text (discussion and additional_info blocks, data_file
  // payloads), where nothing verified the quoting: the strict rules for every ODV.
  strict: Partial<OdvValues>
  // For inline payload JSON, which is never run as a shell command.
  json: Partial<OdvValues>
  // Variable mode only: the values the generated script exports as ODV_<name>,
  // shown as export lines above blocks that only expand "$ODV_<name>" as a
  // variable.
  exported: Partial<OdvValues>
}

// Whether a value may be shown in place of its placeholder in displayed code.
// The strict text-mode rules apply even for a rule whose generator never
// substitutes (and so never applies them): a remediation block containing
// `a"; rm -rf ~ #` would otherwise be shown and copied as a working command.
function passesStrictDisplayGate(odv: Odv, value: OrgDefinedValue, ruleId: string): boolean {
  return validateOdvValue(odv, value, 'text', ruleId) === null
}

// In a verified shell, a quoted placeholder only needs the characters that
// would end that quoting kept out, on top of the datatype and rule checks.
function passesVerifiedShellDisplayGate(odv: Odv, value: OrgDefinedValue, ruleId: string): boolean {
  if (odv.quoting === 'unquoted') return passesStrictDisplayGate(odv, value, ruleId)
  if (validateOdvValue(odv, value, 'none', ruleId) !== null) return false
  const text = String(value)
  return !QUOTED_DISPLAY_DENIED[odv.quoting].some(({ sequence }) => text.includes(sequence))
}

// Code blocks are display-only, but a displayed command gets copied and run,
// so a value is shown in place of its placeholder only if it is safe there
// (the verified shell or strict gate). JSON is escaped as a string, so it only needs the
// ODV's own validation. In variable mode the script exports ODV_<name> and the
// shell expands "$ODV_<name>" itself, so text-replacing it would show a script
// that is not the one that runs; script and json leave that ODV out and the
// value is offered as `exported` instead, validated and canonicalised exactly
// as the generator does (resolveOdvs in checkPlan.ts).
export function codeOdvValues(rule: Rule, values: OdvValues): CodeOdvValues {
  const result: CodeOdvValues = { verifiedShell: {}, strict: {}, json: {}, exported: {} }
  for (const odv of rule.odvs) {
    const value = Object.hasOwn(values, odv.name) ? values[odv.name] : undefined
    if (value === undefined) continue
    const canonicalValue = canonicalOdvValue(odv, value)
    const mode = odvSubstitutionMode(rule, odv)
    if (mode === 'variable') {
      if (validateOdvValue(odv, canonicalValue, mode, rule.id) === null) result.exported[odv.name] = canonicalValue
      continue
    }
    if (passesVerifiedShellDisplayGate(odv, canonicalValue, rule.id)) result.verifiedShell[odv.name] = canonicalValue
    if (passesStrictDisplayGate(odv, canonicalValue, rule.id)) result.strict[odv.name] = canonicalValue
    if (validateOdvValue(odv, canonicalValue, mode, rule.id) === null) result.json[odv.name] = canonicalValue
  }
  return result
}

// For JSON text, each value goes in as the contents of a JSON string so a
// quote or backslash in it cannot break the displayed document.
export function substituteOdvsInJson(jsonText: string, values: Partial<OdvValues>): string {
  const escapedValues: Record<string, string> = {}
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) escapedValues[name] = JSON.stringify(String(value)).slice(1, -1)
  }
  return substituteOdvs(jsonText, escapedValues)
}

// The exact text a code block shows, and therefore copies.
export function codeTextWithOdvs(code: string, values: Partial<OdvValues>, isJson: boolean): string {
  return isJson ? substituteOdvsInJson(code, values) : substituteOdvs(code, values)
}

const WHOLE_ODV_NAME_PATTERN = /^\$ODV_([a-z][a-z0-9_]*)$/

// The ODV a registry setting's data names, or null. Registry data names an ODV
// only as a whole-value "$ODV_<name>"; it is never text inside a longer string.
export function registryOdvName(data: unknown): string | null {
  if (typeof data !== 'string') return null
  return WHOLE_ODV_NAME_PATTERN.exec(data)?.[1] ?? null
}

// The setting with its ODV placeholder replaced by the value the reader chose
// (values as usableOdvValues returns them). Registry data is structured, not
// shell text, so the value goes in as data of the setting's type with no
// quoting rules. A setting whose ODV has no value is returned unchanged.
export function resolveRegistrySetting(setting: RegistrySetting, values: Partial<OdvValues>): RegistrySetting {
  const odvName = registryOdvName(setting.data)
  if (odvName === null || !Object.hasOwn(values, odvName)) return setting
  const value = values[odvName] as OrgDefinedValue
  if (setting.type === 'REG_DWORD' || setting.type === 'REG_QWORD') {
    const asNumber = typeof value === 'number' ? value : INTEGER_PATTERN.test(value) ? Number(value) : null
    return asNumber === null ? setting : { ...setting, data: asNumber }
  }
  return { ...setting, data: String(value) }
}

export function containsOdvPlaceholder(text: string): boolean {
  return text.includes(ODV_PLACEHOLDER_PREFIX)
}

export interface OdvQuickPick {
  label: string
  value: OrgDefinedValue
}

// Grouped benchmark codes sharing a value would name the same benchmark
// twice, so each value lists a label once.
export function odvQuickPicks(odv: Odv, index: VocabularyIndex): OdvQuickPick[] {
  const picks: OdvQuickPick[] = []
  if (odv.recommended !== undefined && odv.recommended !== null) {
    picks.push({ label: 'Recommended', value: odv.recommended })
  }

  const benchmarkLabelsByValue = new Map<OrgDefinedValue, Set<string>>()
  for (const [benchmarkName, value] of Object.entries(odv.by_benchmark)) {
    const labels = benchmarkLabelsByValue.get(value) ?? new Set<string>()
    labels.add(termLabel(index, 'benchmarks', benchmarkName))
    benchmarkLabelsByValue.set(value, labels)
  }
  for (const [value, labels] of benchmarkLabelsByValue) {
    picks.push({ label: Array.from(labels).join(', '), value })
  }
  return picks
}

export type OdvPreparation = { valid: true; value: OrgDefinedValue } | { valid: false; error: string }

const TRAILING_NEWLINES_PATTERN = /\n+$/

// The single path from raw input (typed, quick-picked or imported) to a
// storable value. In variable mode the check compares against `cat` output,
// which loses trailing newlines, so a banner ending in one could never pass.
export function prepareOdvValue(
  odv: Odv,
  value: OrgDefinedValue,
  mode: OdvSubstitutionMode,
  ruleId: string,
): OdvPreparation {
  const normalized = mode === 'variable' && typeof value === 'string' ? value.replace(TRAILING_NEWLINES_PATTERN, '') : value
  const error = validateOdvValue(odv, normalized, mode, ruleId)
  if (error) return { valid: false, error }
  return { valid: true, value: canonicalOdvValue(odv, normalized) }
}

// The values to display or substitute: a stored value that no longer
// validates (e.g. left in localStorage by an older build) is ignored in
// favour of the recommended value rather than trusted.
export function usableOdvValues(rule: Rule, stored: OdvValues): OdvValues {
  const usable: OdvValues = {}
  for (const odv of rule.odvs) {
    const selected = Object.hasOwn(stored, odv.name) ? stored[odv.name] : undefined
    const mode = odvSubstitutionMode(rule, odv)
    const usableSelection = selected !== undefined && validateOdvValue(odv, selected, mode, rule.id) === null ? selected : null
    const effective = effectiveOdvValue(odv, usableSelection)
    if (effective !== null) usable[odv.name] = effective
  }
  return usable
}
