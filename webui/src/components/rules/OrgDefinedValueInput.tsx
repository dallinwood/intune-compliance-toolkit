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
      <div className="flex items-center gap-2 text-sm">
        <BooleanToggle value={typeof value === 'boolean' ? value : undefined} onChange={onChange} onClear={onClear} />
        <span className="font-mono text-xs text-slate-600">{check.variable}</span>
      </div>
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

// A checkbox can only represent two states, so an admin who never touches
// it looks identical to one who explicitly set it to false - the former
// must still block generation (no value entered), the latter must not.
// This makes "never answered" its own explicit, visible state instead of
// an accidental side effect of default-unchecked.
function BooleanToggle({
  value,
  onChange,
  onClear,
}: {
  value: boolean | undefined
  onChange: (value: boolean) => void
  onClear: () => void
}) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-slate-300 text-xs">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={
          value === true
            ? 'bg-emerald-600 px-2 py-0.5 font-medium text-white'
            : 'bg-white px-2 py-0.5 text-slate-500 hover:bg-slate-50'
        }
      >
        True
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={
          value === false
            ? 'border-l border-slate-300 bg-rose-600 px-2 py-0.5 font-medium text-white'
            : 'border-l border-slate-300 bg-white px-2 py-0.5 text-slate-500 hover:bg-slate-50'
        }
      >
        False
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={value === undefined}
        title="Clear - treat as never answered"
        className="border-l border-slate-300 bg-white px-2 py-0.5 text-slate-400 enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Clear
      </button>
    </div>
  )
}
