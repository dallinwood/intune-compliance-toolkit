import { deriveComplianceVariableName, hasInScriptFallback, mapDataType, mapOperator, type IntuneDataType, type IntuneOperator } from './operatorMap'
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
// when the operator has no native Intune equivalent and no in-script
// fallback (like) - both are caller bugs: generation must be
// blocked/rerouted before this is ever called for such a check, not
// silently produce a wrong policy.
export function buildRuleEntry(
  check: OutputCheck,
  rule: RuleSummary,
  organizationDefinedValues: Record<string, OrgDefinedValue>,
): IntuneRuleEntry {
  let settingName: string
  let operator: IntuneOperator
  let dataType: IntuneDataType
  let operand: string | number | boolean

  if (hasInScriptFallback(check.operator)) {
    // The literal comparison target has to be baked into the discovery
    // script text at generation time (see scriptGen/*.ts), which isn't
    // wired up for an admin-supplied value - classifyRule() must route a
    // check like this to manual attestation instead of calling here.
    if (check.value_source === 'organization_defined') {
      throw new Error(
        `Check "${check.variable}" uses operator "${check.operator}" with an organization-defined value, which ` +
          'in-script evaluation does not support yet - classifyRule() must route this to manual attestation.',
      )
    }
    settingName = deriveComplianceVariableName(check.variable)
    operator = 'IsEquals'
    dataType = 'Boolean'
    operand = true
  } else {
    const resolved = check.value_source === 'organization_defined' ? organizationDefinedValues[check.variable] : check.value
    if (resolved === undefined || resolved === null) {
      throw new Error(`No value available yet for organization-defined variable "${check.variable}".`)
    }
    settingName = check.variable
    operator = mapOperator(check.operator)
    dataType = mapDataType(check.data_type)
    operand = resolved
  }

  const entry: IntuneRuleEntry = {
    SettingName: settingName,
    Operator: operator,
    DataType: dataType,
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
