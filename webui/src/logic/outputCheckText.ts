import type { Operator, OutputCheck } from '../types/rule-detail'

const OPERATOR_PHRASES: Record<Operator, string> = {
  eq: 'equals',
  ne: 'does not equal',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  contains: 'contains',
  like: 'matches',
}

// Human-readable pass/fail criterion for one output_check, e.g.
// "cis_macos26_1_6_days is at least 30" - used so a rule's detail view
// states what's actually being compared without the admin reading raw JSON.
export function describeOutputCheck(check: OutputCheck): string {
  const phrase = OPERATOR_PHRASES[check.operator]
  const valueText = check.value_source === 'organization_defined' ? '(organization-defined value)' : String(check.value)
  return `${check.variable} ${phrase} ${valueText}`
}
