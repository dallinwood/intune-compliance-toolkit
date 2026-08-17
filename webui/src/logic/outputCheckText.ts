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
// "cis_macos26_1_6_days is at least 30" - used as a full-sentence tooltip
// alongside the compact badge rendering (see operatorSymbol/formatCheckValue)
// so the detail view states what's actually being compared without the
// admin reading raw JSON.
export function describeOutputCheck(check: OutputCheck): string {
  const phrase = OPERATOR_PHRASES[check.operator]
  const valueText = check.value_source === 'organization_defined' ? '(organization-defined value)' : String(check.value)
  return `${check.variable} ${phrase} ${valueText}`
}

const OPERATOR_SYMBOLS: Record<Operator, string> = {
  eq: '=',
  ne: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  contains: 'contains',
  like: 'matches',
}

// Compact operator label for the fixed operator set, used in a badge
// between the variable and value rather than a full sentence.
export function operatorSymbol(operator: Operator): string {
  return OPERATOR_SYMBOLS[operator]
}

// Short value text for the same compact badge layout - "org-defined" reads
// better at badge width than describeOutputCheck's full parenthetical.
export function formatCheckValue(check: OutputCheck): string {
  return check.value_source === 'organization_defined' ? 'org-defined' : String(check.value)
}
