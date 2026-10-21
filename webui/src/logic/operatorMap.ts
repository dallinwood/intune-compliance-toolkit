// Verified against Microsoft's own schema doc (Create a JSON file for
// custom compliance settings in Microsoft Intune) - Intune's Operator
// enum is exactly these six comparison operators, and DataType these three.
// The mSCP generator only ever emits IsEquals.
export type IntuneOperator = 'IsEquals' | 'NotEquals' | 'GreaterThan' | 'GreaterEquals' | 'LessThan' | 'LessEquals'
export type IntuneDataType = 'Boolean' | 'Int64' | 'String'
