import { Badge } from '@/components/ui/badge'
import type { OrgDefinedValue } from '../../logic/selectionEntry'
import { describeOutputCheck, formatCheckValue, operatorSymbol } from '../../logic/outputCheckText'
import type { OutputCheck } from '../../types/rule-detail'

// Compact variable / operator / value badge row for one output_check.
// describeOutputCheck's full sentence is still there as a hover tooltip
// for accessibility, but the fixed, small operator set reads better here
// as a symbol badge than as prose.
export function OutputCheckRow({
  check,
  organizationDefinedValues,
}: {
  check: OutputCheck
  organizationDefinedValues?: Record<string, OrgDefinedValue>
}) {
  const needsValue = check.value_source === 'organization_defined' && organizationDefinedValues?.[check.variable] === undefined

  return (
    <div className="flex flex-wrap items-center gap-1.5" title={describeOutputCheck(check, organizationDefinedValues)}>
      <Badge render={<code />} className="rounded bg-white font-mono text-xs text-slate-700 ring-1 ring-slate-200">
        {check.variable}
      </Badge>
      <Badge className="rounded-full bg-indigo-50 font-mono text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">
        {operatorSymbol(check.operator)}
      </Badge>
      <Badge
        render={<code />}
        className={
          needsValue
            ? 'rounded bg-amber-50 font-mono text-xs text-amber-700 italic ring-1 ring-amber-200'
            : 'rounded bg-white font-mono text-xs text-slate-700 ring-1 ring-slate-200'
        }
      >
        {formatCheckValue(check, organizationDefinedValues)}
      </Badge>
    </div>
  )
}
