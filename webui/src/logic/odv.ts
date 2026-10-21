import type { Odv, Rule } from '../types/library'
import { benchmarkLabel } from './benchmarkLabels'
import type { OrgDefinedValue } from './selectionEntry'

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
const COMMAND_SUBSTITUTION: DeniedSequence = { sequence: '$(', description: '"$("' }
const PARAMETER_EXPANSION: DeniedSequence = { sequence: '${', description: '"${"' }

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
const ODV_PLACEHOLDER = '$ODV'

// Entries are hand-reviewed check shells where `$ODV` is only ever expanded as a double-quoted variable, so the generator can define ODV as a variable instead of text-replacing.
export const ODV_VARIABLE_ALLOWLIST: Readonly<Record<string, string>> = {
  'mscp.os_policy_banner_ssh_configure': 'bannerText="$ODV"\ntest "$(cat /etc/banner)" = "$bannerText" && echo "1" || echo "0"',
}

export function odvSubstitutionMode(rule: Rule): OdvSubstitutionMode {
  const shellTexts = [rule.check?.default?.shell, ...Object.values(rule.check?.by_version ?? {}).map((check) => check.shell)]
  const shellsWithOdv = shellTexts.filter((shellText): shellText is string => !!shellText?.includes(ODV_PLACEHOLDER))
  if (shellsWithOdv.length === 0) return 'none'

  const allowlistedShell = ODV_VARIABLE_ALLOWLIST[rule.id]
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
// reason. Datatype rules run first, then the extra rules for values that are
// text-replaced into the shell.
export function validateOdvValue(odv: Odv, value: OrgDefinedValue, mode: OdvSubstitutionMode): string | null {
  const text = String(value)
  if (text.trim() === '') return 'Value must not be empty.'

  const datatypeProblem = validateAgainstDatatype(odv, text)
  if (datatypeProblem) return datatypeProblem

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

// Plain text replacement of every $ODV, as mSCP does. A replacer function
// keeps "$&" and similar sequences in the value from being interpreted.
export function substituteOdv(text: string, value: OrgDefinedValue): string {
  return text.replaceAll('$ODV', () => String(value))
}

export function containsOdvPlaceholder(text: string): boolean {
  return text.includes(ODV_PLACEHOLDER)
}

export function displayWithOdv(text: string, value: OrgDefinedValue | null): string {
  return substituteOdv(text, value ?? '[value]')
}

export interface OdvQuickPick {
  label: string
  value: OrgDefinedValue
}

export function odvQuickPicks(odv: Odv): OdvQuickPick[] {
  const picks: OdvQuickPick[] = []
  if (odv.recommended !== undefined && odv.recommended !== null) {
    picks.push({ label: 'Recommended', value: odv.recommended })
  }

  const benchmarkLabelsByValue = new Map<OrgDefinedValue, string[]>()
  for (const [benchmarkName, value] of Object.entries(odv.by_benchmark)) {
    const labels = benchmarkLabelsByValue.get(value) ?? []
    labels.push(benchmarkLabel(benchmarkName))
    benchmarkLabelsByValue.set(value, labels)
  }
  for (const [value, labels] of benchmarkLabelsByValue) {
    picks.push({ label: labels.join(', '), value })
  }
  return picks
}

export type OdvPreparation = { valid: true; value: OrgDefinedValue } | { valid: false; error: string }

const TRAILING_NEWLINES_PATTERN = /\n+$/

// The single path from raw input (typed, quick-picked or imported) to a
// storable value. In variable mode the check compares against `cat` output,
// which loses trailing newlines, so a banner ending in one could never pass.
export function prepareOdvValue(odv: Odv, value: OrgDefinedValue, mode: OdvSubstitutionMode): OdvPreparation {
  const normalized = mode === 'variable' && typeof value === 'string' ? value.replace(TRAILING_NEWLINES_PATTERN, '') : value
  const error = validateOdvValue(odv, normalized, mode)
  if (error) return { valid: false, error }
  return { valid: true, value: canonicalOdvValue(odv, normalized) }
}

// The value to display or substitute: a stored value that no longer
// validates (e.g. left in localStorage by an older build) is ignored in
// favour of the recommended value rather than trusted.
export function usableOdvValue(
  odv: Odv | null,
  mode: OdvSubstitutionMode,
  selected: OrgDefinedValue | null,
): OrgDefinedValue | null {
  if (!odv) return null
  const usableSelection = selected !== null && validateOdvValue(odv, selected, mode) === null ? selected : null
  return effectiveOdvValue(odv, usableSelection)
}
