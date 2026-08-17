import { useEffect, useState } from 'react'
import type { OrgDefinedValue } from '../../logic/selectionEntry'
import type { OutputCheck } from '../../types/rule-detail'

export function OrgDefinedValueInput({
  check,
  value,
  onChange,
  onClear,
}: {
  check: OutputCheck
  value: OrgDefinedValue | undefined
  onChange: (value: OrgDefinedValue) => void
  onClear: () => void
}) {
  // Buffered locally so the field can sit empty mid-edit without a 0/""
  // being forced back in - that forced value was why backspacing to empty
  // then typing "12" landed as "012": clearing got coerced straight back
  // to 0, and the next keystroke appended after it instead of replacing it.
  const [text, setText] = useState(() => (value === undefined ? '' : String(value)))

  useEffect(() => {
    setText(value === undefined ? '' : String(value))
  }, [value])

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
          value={text}
          onChange={(event) => {
            const raw = event.target.value
            setText(raw)
            // Don't commit a half-typed value (empty, or a bare "-" while
            // starting a negative number) - only a fully parseable number
            // updates the stored selection.
            if (raw === '' || raw === '-') return
            const parsed = Number(raw)
            if (!Number.isNaN(parsed)) onChange(parsed)
          }}
          onBlur={() => {
            if (text === '') onClear()
          }}
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
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          onChange(event.target.value)
        }}
        onBlur={() => {
          if (text === '') onClear()
        }}
      />
    </label>
  )
}
