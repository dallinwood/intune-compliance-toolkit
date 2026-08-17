import type { OrgDefinedValue } from './selectionEntry'
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

// For an organization_defined check, the rule JSON's own `value` is always
// null - the real value (once the admin has entered one) lives in the
// selection's organizationDefinedValues map, keyed by variable name.
function resolveOrganizationDefinedValue(
  check: OutputCheck,
  organizationDefinedValues?: Record<string, OrgDefinedValue>,
): OrgDefinedValue | undefined {
  return organizationDefinedValues?.[check.variable]
}

// Human-readable pass/fail criterion for one output_check, e.g.
// "cis_macos26_1_6_days is at least 30" - used as a full-sentence tooltip
// alongside the compact badge rendering (see operatorSymbol/formatCheckValue)
// so the detail view states what's actually being compared without the
// admin reading raw JSON.
export function describeOutputCheck(check: OutputCheck, organizationDefinedValues?: Record<string, OrgDefinedValue>): string {
  const phrase = OPERATOR_PHRASES[check.operator]
  let valueText: string
  if (check.value_source === 'organization_defined') {
    const resolved = resolveOrganizationDefinedValue(check, organizationDefinedValues)
    valueText = resolved === undefined ? '(no value set yet)' : String(resolved)
  } else {
    valueText = String(check.value)
  }
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

// Short value text for the same compact badge layout - reflects whatever
// value the admin has already entered for an organization-defined check,
// falling back to a "needs value" placeholder until they have.
export function formatCheckValue(check: OutputCheck, organizationDefinedValues?: Record<string, OrgDefinedValue>): string {
  if (check.value_source === 'organization_defined') {
    const resolved = resolveOrganizationDefinedValue(check, organizationDefinedValues)
    return resolved === undefined ? 'needs value' : String(resolved)
  }
  return String(check.value)
}
