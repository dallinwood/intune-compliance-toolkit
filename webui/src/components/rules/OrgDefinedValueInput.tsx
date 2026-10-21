import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { odvQuickPicks, prepareOdvValue, validateOdvValue, type OdvSubstitutionMode } from '../../logic/odv'
import type { OrgDefinedValue } from '../../logic/selectionEntry'
import type { Odv } from '../../types/library'

const SHORT_VALUE_LENGTH = 24
const HINT_VALUE_LENGTH = 120

function textOf(value: OrgDefinedValue | null): string {
  return value === null ? '' : String(value)
}

function shortened(value: OrgDefinedValue, maxLength: number): string {
  const text = String(value)
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function constraintHint(odv: Odv): string | null {
  const validation = odv.validation
  if (odv.datatype === 'number') {
    if (validation?.min !== undefined && validation.max !== undefined) {
      return `Whole number from ${validation.min} to ${validation.max}.`
    }
    if (validation?.min !== undefined) return `Whole number, at least ${validation.min}.`
    if (validation?.max !== undefined) return `Whole number, at most ${validation.max}.`
    return 'Whole number.'
  }
  if (odv.datatype === 'regex') return 'A regular expression.'
  if (validation?.regex !== undefined) return `Must match ${validation.regex}`
  return null
}

export function OrgDefinedValueInput({
  odv,
  mode,
  storedValue,
  onCommit,
  onClear,
}: {
  odv: Odv
  mode: OdvSubstitutionMode
  storedValue: OrgDefinedValue | null
  onCommit: (value: OrgDefinedValue) => void
  onClear: () => void
}) {
  const inputId = useId()
  const messageId = useId()

  // Buffered locally so the field can hold text that is mid-edit or invalid
  // without it ever reaching the store. The buffer only resyncs when the
  // stored value changes from outside (quick-pick, import, clear) - not
  // after its own commits, or typing "007" would jump to "7" mid-edit and a
  // trailing newline trimmed on commit would vanish from the textarea.
  const [text, setText] = useState(() => textOf(storedValue))
  const [syncedValue, setSyncedValue] = useState(storedValue)
  if (storedValue !== syncedValue) {
    setSyncedValue(storedValue)
    setText(textOf(storedValue))
  }

  const preparation = text === '' ? null : prepareOdvValue(odv, text, mode)
  // Mirrors usableOdvValue: a stored value that fails validation (e.g. left
  // by an older build) is not what the rest of the UI uses.
  const storedValueIsUsable = storedValue !== null && validateOdvValue(odv, storedValue, mode) === null
  const error = preparation && !preparation.valid ? preparation.error : null

  function handleChange(rawValue: string) {
    setText(rawValue)
    if (rawValue === '') {
      setSyncedValue(null)
      onClear()
      return
    }
    const next = prepareOdvValue(odv, rawValue, mode)
    if (next.valid) {
      setSyncedValue(next.value)
      onCommit(next.value)
    }
  }

  const fieldClass = 'rounded text-xs'
  const commonProps = {
    id: inputId,
    value: text,
    'aria-invalid': error !== null,
    'aria-describedby': messageId,
  }

  let field
  if (odv.datatype === 'enum') {
    field = (
      <select
        {...commonProps}
        onChange={(event) => handleChange(event.target.value)}
        className={`h-7 w-full max-w-xs border border-input bg-transparent px-2 ${fieldClass}`}
      >
        <option value="">Use recommended ({String(odv.recommended)})</option>
        {(odv.validation?.enumValues ?? []).map((enumValue) => (
          <option key={enumValue} value={enumValue}>
            {enumValue}
          </option>
        ))}
      </select>
    )
  } else if (odv.datatype === 'string' && mode !== 'text') {
    // Multi-line values (login and SSH banners) are only possible where the
    // value is never text-replaced into a shell.
    field = (
      <textarea
        {...commonProps}
        rows={4}
        onChange={(event) => handleChange(event.target.value)}
        className={`w-full border border-input bg-transparent px-2 py-1 ${fieldClass}`}
      />
    )
  } else {
    field = (
      <Input
        {...commonProps}
        type="text"
        placeholder={String(odv.recommended)}
        // Not type="number": that would silently discard anything
        // non-numeric, hiding exactly the input the validator must explain.
        inputMode={odv.datatype === 'number' ? 'numeric' : undefined}
        onChange={(event) => handleChange(event.target.value)}
        className={`h-7 ${odv.datatype === 'number' ? 'w-32' : 'w-full max-w-md font-mono'} ${fieldClass}`}
      />
    )
  }

  const hint = constraintHint(odv)
  const quickPicks = odvQuickPicks(odv)

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId} className="text-sm font-normal text-slate-700">
        {odv.description}
      </Label>
      {field}
      <div id={messageId} className="space-y-0.5 text-xs">
        {error && (
          <p role="alert" className="text-red-600">
            {error} {storedValueIsUsable && storedValue !== null && <>Not saved; still using {shortened(storedValue, HINT_VALUE_LENGTH)}.</>}
          </p>
        )}
        {!storedValueIsUsable && (
          <p className="break-words text-slate-500">
            Using recommended value: {shortened(odv.recommended, HINT_VALUE_LENGTH)}
          </p>
        )}
        {hint && <p className="text-slate-400">{hint}</p>}
      </div>
      {quickPicks.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {quickPicks.map((pick) => {
            const pickPreparation = prepareOdvValue(odv, pick.value, mode)
            const valueText = String(pick.value)
            const isShort = valueText.length <= SHORT_VALUE_LENGTH && !valueText.includes('\n')
            const isActive = pickPreparation.valid && storedValue === pickPreparation.value
            return (
              <Button
                key={pick.label}
                type="button"
                size="xs"
                variant={isActive ? 'default' : 'outline'}
                aria-pressed={isActive}
                disabled={!pickPreparation.valid}
                title={pickPreparation.valid ? valueText : pickPreparation.error}
                onClick={() => handleChange(valueText)}
                className="h-auto max-w-full py-0.5 whitespace-normal"
              >
                {isShort ? `${pick.label}: ${valueText}` : pick.label}
              </Button>
            )
          })}
        </div>
      )}
    </div>
  )
}
