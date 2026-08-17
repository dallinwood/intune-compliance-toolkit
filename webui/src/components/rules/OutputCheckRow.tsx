import { describeOutputCheck, formatCheckValue, operatorSymbol } from '../../logic/outputCheckText'
import type { OutputCheck } from '../../types/rule-detail'

// Compact variable / operator / value badge row for one output_check.
// describeOutputCheck's full sentence is still there as a hover tooltip
// for accessibility, but the fixed, small operator set reads better here
// as a symbol badge than as prose.
export function OutputCheckRow({ check }: { check: OutputCheck }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" title={describeOutputCheck(check)}>
      <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-slate-700 ring-1 ring-slate-200">
        {check.variable}
      </code>
      <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-mono text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">
        {operatorSymbol(check.operator)}
      </span>
      <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-slate-700 ring-1 ring-slate-200">
        {formatCheckValue(check)}
      </code>
    </div>
  )
}
