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
