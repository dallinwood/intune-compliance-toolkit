import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
        <span className="font-mono text-xs text-slate-600">{check.variable}</span>
        <BooleanToggle
          variable={check.variable}
          value={typeof value === 'boolean' ? value : undefined}
          onChange={onChange}
          onClear={onClear}
        />
      </div>
    )
  }

  if (check.data_type === 'integer') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <span className="font-mono text-xs text-slate-600">{check.variable}</span>
        <Input
          type="number"
          className="h-7 w-24 rounded text-xs"
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
      <Input
        type="text"
        className="h-7 w-48 rounded text-xs"
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
  variable,
  value,
  onChange,
  onClear,
}: {
  variable: string
  value: boolean | undefined
  onChange: (value: boolean) => void
  onClear: () => void
}) {
  return (
    <div role="group" aria-label={`${variable} value`} className="inline-flex items-center gap-1">
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => onChange(true)}
        aria-pressed={value === true}
        className={value === true ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600/90' : ''}
      >
        True
      </Button>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => onChange(false)}
        aria-pressed={value === false}
        className={value === false ? 'border-rose-600 bg-rose-600 text-white hover:bg-rose-600/90' : ''}
      >
        False
      </Button>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={onClear}
        disabled={value === undefined}
        title="Clear - treat as never answered"
      >
        Clear
      </Button>
    </div>
  )
}
