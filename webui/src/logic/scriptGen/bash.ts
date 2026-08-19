import { deriveComplianceVariableName, hasInScriptFallback } from '../operatorMap'
import type { AuditStep, OutputDataType } from '../../types/rule-detail'

// One rule's worth of script content for a single chunk - just the id/title
// (for the comment banner) and the effective scripted method's steps, in
// their original order (lookup steps before the compliance_check steps
// that depend on them).
export interface ScriptableRule {
  id: string
  title: string
  steps: AuditStep[]
}

// Deliberately NOT bash's usual sed/awk-based JSON escaping - jq isn't
// guaranteed present on managed Macs, and this needs only backslash/quote
// escaping plus a safe fallback to `null` for an empty/failed capture (a
// bare unquoted empty would otherwise produce malformed JSON for a
// boolean/integer field). Verified by actually executing generated output
// through bash in scriptGen/bash.test.ts, not just by inspection.
const JSON_HELPER_LINES = [
  '__json_bool() {',
  '  case "$1" in',
  "    true|True|TRUE) printf 'true' ;;",
  "    false|False|FALSE) printf 'false' ;;",
  "    *) printf 'null' ;;",
  '  esac',
  '}',
  '',
  '__json_int() {',
  '  case "$1" in',
  "    ''|*[!0-9-]*) printf 'null' ;;",
  '    *) printf \'%s\' "$1" ;;',
  '  esac',
  '}',
  '',
  '__json_str() {',
  '  if [ -z "$1" ]; then',
  "    printf 'null'",
  '  else',
  '    value=$1',
  '    value=${value//\\\\/\\\\\\\\}',
  '    value=${value//\\"/\\\\\\"}',
  '    printf \'"%s"\' "$value"',
  '  fi',
  '}',
]

// Embeds `text` as a literal (no glob/expansion) segment of a bash `case`
// pattern by single-quoting it - the standard shell-escaping idiom: end the
// quote, insert an escaped literal quote, resume quoting.
function bashSingleQuote(text: string): string {
  return `'${text.replace(/'/g, "'\\''")}'`
}

// A "contains" check has no native Intune operator, so the discovery
// script itself computes the substring test and reports a plain boolean
// under a derived variable name (see operatorMap.ts) - rulesJsonGen.ts then
// points the Intune Rules[] entry at that boolean with IsEquals instead of
// at the raw captured value. Managed Macs ship bash 3.2 (Apple never
// upgrades past GPLv2), which has no `${var,,}` case-folding, so
// case-insensitivity is done by lower-casing the literal at generation
// time (a compile-time constant) and lower-casing the captured value at
// runtime via `tr`, then a `case` pattern whose literal portion is
// single-quoted so any `*`/`?` inside the value can't be read as a glob.
function containsCheckLines(variable: string, value: string): string[] {
  const derived = deriveComplianceVariableName(variable)
  const loweredLiteral = bashSingleQuote(value.toLowerCase())
  return [
    `${variable}__lower=$(printf '%s' "$${variable}" | tr '[:upper:]' '[:lower:]')`,
    `case "$${variable}__lower" in`,
    `  *${loweredLiteral}*) ${derived}=true ;;`,
    `  *) ${derived}=false ;;`,
    'esac',
  ]
}

function jsonHelperCall(variable: string, dataType: OutputDataType): string {
  const helper = dataType === 'boolean' ? '__json_bool' : dataType === 'integer' ? '__json_int' : '__json_str'
  return `"$(${helper} "$${variable}")"`
}

function buildOutputLine(variables: { variable: string; data_type: OutputDataType }[]): string {
  const format = variables.map((entry) => `"${entry.variable}":%s`).join(',')
  const args = variables.map((entry) => jsonHelperCall(entry.variable, entry.data_type)).join(' ')
  return `printf '{${format}}\\n' ${args}`
}

export function generateBashScript(rules: ScriptableRule[]): string {
  const lines: string[] = ['#!/bin/bash', '']
  const variables: { variable: string; data_type: OutputDataType }[] = []

  for (const rule of rules) {
    lines.push(`# --- ${rule.id}: ${rule.title} ---`)
    for (const step of rule.steps) {
      if (!step.check_command_verified) {
        lines.push('# WARNING: unverified check_command')
      }
      lines.push(step.check_command)
      for (const check of step.output_check) {
        variables.push({ variable: check.variable, data_type: check.data_type })
        if (hasInScriptFallback(check.operator)) {
          lines.push(...containsCheckLines(check.variable, String(check.value)))
          variables.push({ variable: deriveComplianceVariableName(check.variable), data_type: 'boolean' })
        }
      }
    }
    lines.push('')
  }

  lines.push(...JSON_HELPER_LINES)
  lines.push('')
  lines.push(buildOutputLine(variables))
  lines.push('exit 0')

  return lines.join('\n') + '\n'
}
