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
const UNSAFE_REGEX_CHARACTER_PATTERN = /[\s;|&<>]/
const UNSAFE_REGEX_DOLLAR_PATTERN = /\$[A-Za-z_{(]/
const ODV_PLACEHOLDER = '$ODV'

interface OdvOccurrences {
  total: number
  insideDoubleQuotes: number
  endedAtTopLevel: boolean
}

type ScanContextKind = 'unquoted' | 'single' | 'ansi' | 'double' | 'cmdsub' | 'backtick'

interface ScanContext {
  kind: ScanContextKind
  parenthesisDepth: number
}

const COMMENT_PRECEDING_CHARACTERS = new Set([' ', '\t', '\n', ';', '(', '|', '&', '`'])

// A small context-stack scanner for bash quoting. It only has to answer
// "is each $ODV directly inside a double-quoted string", so anything it
// cannot place with confidence must end up as not double-quoted.
function countOdvOccurrences(shellText: string): OdvOccurrences {
  const occurrences: OdvOccurrences = { total: 0, insideDoubleQuotes: 0, endedAtTopLevel: true }
  const stack: ScanContext[] = [{ kind: 'unquoted', parenthesisDepth: 0 }]
  let position = 0

  const recordOccurrence = (insideDoubleQuotes: boolean) => {
    occurrences.total += 1
    if (insideDoubleQuotes) occurrences.insideDoubleQuotes += 1
    position += ODV_PLACEHOLDER.length
  }

  while (position < shellText.length) {
    const context = stack[stack.length - 1]
    const character = shellText[position]

    if (shellText.startsWith(ODV_PLACEHOLDER, position)) {
      recordOccurrence(context.kind === 'double')
      continue
    }

    if (character === '\\' && context.kind !== 'single') {
      // substituteOdv replaces an escaped \$ODV too, so it still counts.
      if (shellText.startsWith(ODV_PLACEHOLDER, position + 1)) {
        position += 1
        recordOccurrence(false)
      } else {
        position += 2
      }
      continue
    }

    if (context.kind === 'single') {
      if (character === "'") stack.pop()
      position += 1
      continue
    }

    if (context.kind === 'ansi') {
      if (character === "'") stack.pop()
      position += 1
      continue
    }

    if (character === '`') {
      if (context.kind === 'backtick') stack.pop()
      else stack.push({ kind: 'backtick', parenthesisDepth: 0 })
      position += 1
      continue
    }

    if (character === '$' && shellText[position + 1] === '(') {
      stack.push({ kind: 'cmdsub', parenthesisDepth: 0 })
      position += 2
      continue
    }

    if (context.kind === 'double') {
      if (character === '"') stack.pop()
      position += 1
      continue
    }

    if (character === '$' && shellText[position + 1] === "'") {
      stack.push({ kind: 'ansi', parenthesisDepth: 0 })
      position += 2
      continue
    }
    if (character === "'") {
      stack.push({ kind: 'single', parenthesisDepth: 0 })
      position += 1
      continue
    }
    if (character === '"') {
      stack.push({ kind: 'double', parenthesisDepth: 0 })
      position += 1
      continue
    }

    if (context.kind === 'cmdsub') {
      if (character === '(') context.parenthesisDepth += 1
      else if (character === ')') {
        if (context.parenthesisDepth > 0) context.parenthesisDepth -= 1
        else stack.pop()
      }
    }

    const startsWord = position === 0 || COMMENT_PRECEDING_CHARACTERS.has(shellText[position - 1])
    if (character === '#' && startsWord) {
      let commentEnd = shellText.indexOf('\n', position)
      if (commentEnd === -1) commentEnd = shellText.length
      const commentText = shellText.slice(position, commentEnd)
      const commentOccurrenceCount = commentText.split(ODV_PLACEHOLDER).length - 1
      occurrences.total += commentOccurrenceCount
      position = commentEnd
      continue
    }

    position += 1
  }

  occurrences.endedAtTopLevel = stack.length === 1
  return occurrences
}

// Classifies where $ODV appears in the rule's check shell text, because that
// decides what the value may contain: a value substituted into a quoted
// string needs different protection than one spliced into bare shell. A
// heredoc or a shell that ends inside an open quote makes the analysis
// unreliable, so either forces 'other'.
export function odvShellContext(rule: Rule): OdvShellContext {
  const shellTexts = [rule.check?.default?.shell, ...Object.values(rule.check?.by_version ?? {}).map((check) => check.shell)]
  let total = 0
  let insideDoubleQuotes = 0
  let isAnalysisReliable = true
  for (const shellText of shellTexts) {
    if (!shellText) continue
    const occurrences = countOdvOccurrences(shellText)
    total += occurrences.total
    insideDoubleQuotes += occurrences.insideDoubleQuotes
    if (shellText.includes('<<') || !occurrences.endedAtTopLevel) isAnalysisReliable = false
  }
  if (total === 0) return 'none'
  return total === insideDoubleQuotes && isAnalysisReliable ? 'double_quoted' : 'other'
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
// reason. Datatype rules run first, then the shell-context character rules.
export function validateOdvValue(odv: Odv, value: OrgDefinedValue, context: OdvShellContext): string | null {
  const text = String(value)
  if (text.trim() === '') return 'Value must not be empty.'

  const datatypeProblem = validateAgainstDatatype(odv, text)
  if (datatypeProblem) return datatypeProblem

  for (const { sequence, description } of DENIED_BY_CONTEXT[context]) {
    if (text.includes(sequence)) return `Value must not contain ${description}.`
  }

  if (context === 'other' && odv.datatype === 'string' && !UNQUOTED_STRING_PATTERN.test(text)) {
    return 'Value may only contain letters, digits and . _ : + - characters.'
  }
  if (
    context === 'other' &&
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
