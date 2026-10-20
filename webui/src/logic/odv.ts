import type { Odv, Rule } from '../types/library'
import { benchmarkLabel } from './benchmarkLabels'
import type { OrgDefinedValue } from './selectionEntry'

export type OdvShellContext = 'none' | 'double_quoted' | 'other'

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
const DOLLAR: DeniedSequence = { sequence: '$', description: 'a dollar sign' }
const NEWLINE: DeniedSequence = { sequence: '\n', description: 'a newline' }
const COMMAND_SUBSTITUTION: DeniedSequence = { sequence: '$(', description: '"$("' }
const PARAMETER_EXPANSION: DeniedSequence = { sequence: '${', description: '"${"' }

const DENIED_BY_CONTEXT: Record<OdvShellContext, DeniedSequence[]> = {
  none: [CARRIAGE_RETURN, NUL],
  double_quoted: [CARRIAGE_RETURN, NUL, DOUBLE_QUOTE, DOLLAR, BACKTICK, BACKSLASH],
  other: [
    CARRIAGE_RETURN,
    NUL,
    SINGLE_QUOTE,
    DOUBLE_QUOTE,
    BACKTICK,
    BACKSLASH,
    NEWLINE,
    COMMAND_SUBSTITUTION,
    PARAMETER_EXPANSION,
  ],
}

const INTEGER_PATTERN = /^-?[0-9]+$/
const UNQUOTED_STRING_PATTERN = /^[A-Za-z0-9._:+-]+$/
const ODV_PLACEHOLDER = '$ODV'
const QUOTED_ODV_PLACEHOLDER = '"$ODV"'

// Classifies where $ODV appears in the rule's check shell text, because that
// decides what the value may contain: a value substituted into a quoted
// string needs different protection than one spliced into bare shell.
export function odvShellContext(rule: Rule): OdvShellContext {
  const shellTexts = [rule.check?.default?.shell, ...Object.values(rule.check?.by_version ?? {}).map((check) => check.shell)]
  let occurrenceCount = 0
  let quotedOccurrenceCount = 0
  for (const shellText of shellTexts) {
    if (!shellText) continue
    occurrenceCount += shellText.split(ODV_PLACEHOLDER).length - 1
    quotedOccurrenceCount += shellText.split(QUOTED_ODV_PLACEHOLDER).length - 1
  }
  if (occurrenceCount === 0) return 'none'
  return occurrenceCount === quotedOccurrenceCount ? 'double_quoted' : 'other'
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

  if (odv.datatype === 'regex') {
    try {
      new RegExp(text)
    } catch {
      return 'Value must be a valid regular expression.'
    }
  }

  if (validation?.regex !== undefined && !new RegExp(validation.regex).test(text)) {
    return `Value must match the pattern ${validation.regex}.`
  }
  return null
}

// Returns null when the value is acceptable, otherwise a human-readable
// reason. Datatype rules run first, then the shell-context character rules.
export function validateOdvValue(odv: Odv, value: OrgDefinedValue, context: OdvShellContext): string | null {
  const text = String(value)

  const datatypeProblem = validateAgainstDatatype(odv, text)
  if (datatypeProblem) return datatypeProblem

  for (const { sequence, description } of DENIED_BY_CONTEXT[context]) {
    if (text.includes(sequence)) return `Value must not contain ${description}.`
  }

  if (context === 'other' && odv.datatype === 'string' && !UNQUOTED_STRING_PATTERN.test(text)) {
    return 'Value may only contain letters, digits and . _ : + - characters.'
  }
  return null
}

// Plain text replacement of every $ODV, as mSCP does. A replacer function
// keeps "$&" and similar sequences in the value from being interpreted.
export function substituteOdv(text: string, value: OrgDefinedValue): string {
  return text.replaceAll('$ODV', () => String(value))
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
