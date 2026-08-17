import type { OrgDefinedValue } from '../../logic/selectionEntry'
import type { OutputCheck } from '../../types/rule-detail'

export function OrgDefinedValueInput({
  check,
  value,
  onChange,
}: {
  check: OutputCheck
  value: OrgDefinedValue | undefined
  onChange: (value: OrgDefinedValue) => void
}) {
  if (check.data_type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <span className="font-mono text-xs text-slate-600">{check.variable}</span>
      </label>
    )
  }

  if (check.data_type === 'integer') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <span className="font-mono text-xs text-slate-600">{check.variable}</span>
        <input
          type="number"
          className="w-24 rounded border border-slate-300 px-1 py-0.5 text-xs"
          value={typeof value === 'number' ? value : ''}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </label>
    )
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-mono text-xs text-slate-600">{check.variable}</span>
      <input
        type="text"
        className="w-48 rounded border border-slate-300 px-1 py-0.5 text-xs"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
