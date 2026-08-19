import type { Operator, OutputDataType } from '../types/rule-detail'

// Verified against Microsoft's own schema doc (Create a JSON file for
// custom compliance settings in Microsoft Intune) - Intune's Operator
// enum is exactly these six comparison operators. There is no native
// substring/pattern-match operator, so "contains"/"like" have no mapping;
// callers must check isSupportedOperator() first and route anything
// unsupported to manual attestation rather than generating a script for it.
export type IntuneOperator = 'IsEquals' | 'NotEquals' | 'GreaterThan' | 'GreaterEquals' | 'LessThan' | 'LessEquals'
export type IntuneDataType = 'Boolean' | 'Int64' | 'String'

const OPERATOR_MAP: Partial<Record<Operator, IntuneOperator>> = {
  eq: 'IsEquals',
  ne: 'NotEquals',
  gt: 'GreaterThan',
  gte: 'GreaterEquals',
  lt: 'LessThan',
  lte: 'LessEquals',
}

const DATA_TYPE_MAP: Record<OutputDataType, IntuneDataType> = {
  boolean: 'Boolean',
  integer: 'Int64',
  string: 'String',
}

export function isSupportedOperator(operator: Operator): boolean {
  return operator in OPERATOR_MAP
}

export function mapOperator(operator: Operator): IntuneOperator {
  const mapped = OPERATOR_MAP[operator]
  if (!mapped) {
    throw new Error(
      `Operator "${operator}" has no native Intune equivalent (Intune only supports IsEquals/NotEquals/` +
        'GreaterThan/GreaterEquals/LessThan/LessEquals) - call isSupportedOperator() first.',
    )
  }
  return mapped
}

export function mapDataType(dataType: OutputDataType): IntuneDataType {
  return DATA_TYPE_MAP[dataType]
}

// "contains" has no native Intune operator, but unlike "like" (undefined
// semantics - no rule uses it, and no source document has ever specified
// whether it means a glob pattern or something else) it has one concrete,
// well-defined meaning: a case-insensitive substring test. That can be
// computed in the discovery script itself and reported back as a plain
// boolean, which IsEquals can then check natively. "like" stays unsupported
// until a real rule needs it and forces a decision on its semantics.
export function hasInScriptFallback(operator: Operator): boolean {
  return operator === 'contains'
}

// The discovery script computes compliance for an in-script-fallback check
// under this derived name rather than the check's own variable, so both the
// script generators (which assign it) and rulesJsonGen (which references it
// as the Intune SettingName) must go through this one function - never
// reconstruct the suffix separately. The double-underscore matches this
// codebase's existing convention for generator-owned names ($__result,
// __json_bool in scriptGen/bash.ts): it signals "not something the rule
// JSON declared."
export function deriveComplianceVariableName(variable: string): string {
  return `${variable}__compliant`
}
