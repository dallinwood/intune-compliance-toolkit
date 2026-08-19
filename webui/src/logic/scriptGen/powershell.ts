import { deriveComplianceVariableName, hasInScriptFallback } from '../operatorMap'
import type { AuditStep } from '../../types/rule-detail'

export interface ScriptableRule {
  id: string
  title: string
  steps: AuditStep[]
}

// A "contains" check has no native Intune operator, so the discovery
// script itself computes the substring test and reports a plain boolean
// under a derived variable name (see operatorMap.ts) - rulesJsonGen.ts then
// points the Intune Rules[] entry at that boolean with IsEquals instead of
// at the raw captured value. .IndexOf(..., OrdinalIgnoreCase) is used
// rather than -like: the search term is a literal, not a pattern, so this
// needs no wildcard escaping (only the embedded single quote).
function containsCheckLine(variable: string, value: string): string {
  const escapedValue = value.replace(/'/g, "''")
  const derived = deriveComplianceVariableName(variable)
  return `$${derived} = ([string]$${variable}).IndexOf('${escapedValue}', [System.StringComparison]::OrdinalIgnoreCase) -ge 0`
}

// PowerShell's own ConvertTo-Json handles type serialization correctly
// (unlike bash, no manual escaping needed), so the JSON-building step is
// just an ordered hashtable of every output_check variable (plus any
// derived compliance booleans) - lookup-step variables have no
// output_check and are naturally excluded.
export function generatePowerShellScript(rules: ScriptableRule[]): string {
  const lines: string[] = []
  const variables: string[] = []

  for (const rule of rules) {
    lines.push(`# --- ${rule.id}: ${rule.title} ---`)
    for (const step of rule.steps) {
      if (!step.check_command_verified) {
        lines.push('# WARNING: unverified check_command')
      }
      lines.push(step.check_command)
      for (const check of step.output_check) {
        variables.push(check.variable)
        if (hasInScriptFallback(check.operator)) {
          lines.push(containsCheckLine(check.variable, String(check.value)))
          variables.push(deriveComplianceVariableName(check.variable))
        }
      }
    }
    lines.push('')
  }

  lines.push('$__result = [ordered]@{')
  for (const variable of variables) {
    lines.push(`  '${variable}' = $${variable}`)
  }
  lines.push('}')
  lines.push('$__result | ConvertTo-Json -Compress')
  lines.push('exit 0')

  return lines.join('\n') + '\n'
}
