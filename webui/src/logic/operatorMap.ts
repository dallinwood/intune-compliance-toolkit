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
