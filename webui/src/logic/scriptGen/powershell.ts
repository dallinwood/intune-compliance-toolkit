import type { AuditStep } from '../../types/rule-detail'

export interface ScriptableRule {
  id: string
  title: string
  steps: AuditStep[]
}

// PowerShell's own ConvertTo-Json handles type serialization correctly
// (unlike bash, no manual escaping needed), so the JSON-building step is
// just an ordered hashtable of every output_check variable - lookup-step
// variables have no output_check and are naturally excluded.
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
