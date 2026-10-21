// Kept for the future Windows source: these are the pre-v3 (CIS-era) audit
// types and helpers that scriptGen/powershell.ts still needs. They are not
// wired into generation; the mSCP generator uses checkPlan.ts instead.

export type StepRole = 'compliance_check' | 'lookup'
export type OutputDataType = 'boolean' | 'integer' | 'string'
export type Operator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'like'
export type ValueSource = 'benchmark' | 'organization_defined'

export interface OutputCheck {
  variable: string
  data_type: OutputDataType
  operator: Operator
  value: string | number | boolean | null
  value_source: ValueSource
}

export interface AuditStep {
  step_role: StepRole
  original_command: string | null
  check_command: string
  check_command_verified: boolean
  output_description: string
  check_command_notes?: string
  output_check: OutputCheck[]
}

// "contains" has no native Intune operator but one well-defined meaning (a
// case-insensitive substring test), so the discovery script computes it and
// reports a plain boolean that IsEquals can check. "like" stays unsupported
// until a real rule needs it and forces a decision on its semantics.
export function hasInScriptFallback(operator: Operator): boolean {
  return operator === 'contains'
}

// The double underscore marks a generator-owned name, not one the rule
// declared. Script generators and Rules JSON must both use this function.
export function deriveComplianceVariableName(variable: string): string {
  return `${variable}__compliant`
}
