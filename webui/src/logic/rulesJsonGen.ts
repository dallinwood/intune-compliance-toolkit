import { mapDataType, mapOperator, type IntuneDataType, type IntuneOperator } from './operatorMap'
import type { OrgDefinedValue } from './selectionEntry'
import type { AuditMethod, OutputCheck } from '../types/rule-detail'

export interface RemediationString {
  Language: string
  Title: string
  Description: string
}

export interface IntuneRuleEntry {
  SettingName: string
  Operator: IntuneOperator
  DataType: IntuneDataType
  Operand: string | number | boolean
  MoreInfoUrl?: string
  RemediationStrings: RemediationString[]
}

// Just the fields of a RuleDetail this needs - callers pass the full
// object, but keeping this narrow makes the function easy to test without
// constructing an entire rule.
export interface RuleSummary {
  title: string
  description: string
  references: string[]
}

// Builds one Intune Rules[] entry for a single output_check. Throws rather
// than guessing when an organization-defined check has no value yet, or
// when the operator has no native Intune equivalent (contains/like) -
// both are caller bugs: generation must be blocked/rerouted before this
// is ever called for such a check, not silently produce a wrong policy.
export function buildRuleEntry(
  check: OutputCheck,
  rule: RuleSummary,
  organizationDefinedValues: Record<string, OrgDefinedValue>,
): IntuneRuleEntry {
  const operand = check.value_source === 'organization_defined' ? organizationDefinedValues[check.variable] : check.value

  if (operand === undefined || operand === null) {
    throw new Error(`No value available yet for organization-defined variable "${check.variable}".`)
  }

  const entry: IntuneRuleEntry = {
    SettingName: check.variable,
    Operator: mapOperator(check.operator),
    DataType: mapDataType(check.data_type),
    Operand: operand,
    RemediationStrings: [{ Language: 'en_US', Title: rule.title, Description: rule.description }],
  }

  const moreInfoUrl = rule.references[0]
  if (moreInfoUrl) entry.MoreInfoUrl = moreInfoUrl

  return entry
}

export function buildRuleEntriesForMethod(
  method: AuditMethod,
  rule: RuleSummary,
  organizationDefinedValues: Record<string, OrgDefinedValue>,
): IntuneRuleEntry[] {
  return (method.steps ?? []).flatMap((step) => step.output_check.map((check) => buildRuleEntry(check, rule, organizationDefinedValues)))
}
