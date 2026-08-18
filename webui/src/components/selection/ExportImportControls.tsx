import { useRef, useState, type ChangeEvent } from 'react'
import { Button } from '@/components/ui/button'
import { buildSettingsFile, resolveImportedSelections, serializeSettingsFile, validateSettingsFile } from '../../logic/exportImport'
import { refKey } from '../../logic/selectionEntry'
import { useSelectionStore } from '../../state/selectionStore'
import type { RuleRow } from '../../types/rule-row'

export function ExportImportControls({ rows }: { rows: RuleRow[] }) {
  const selections = useSelectionStore((store) => store.selections)
  const setAllSelections = useSelectionStore((store) => store.setAllSelections)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)

  function handleExport() {
    const file = buildSettingsFile(selections, new Date().toISOString())
    const blob = new Blob([serializeSettingsFile(file)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `intune-toolkit-selections-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function handleFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // allow re-choosing the same file again later
    if (!file) return

    setMessage(null)

    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      setMessage('That file is not valid JSON.')
      return
    }

    const validation = validateSettingsFile(parsed)
    if (!validation.valid) {
      setMessage(validation.error)
      return
    }

    // Import is a "load this snapshot" action, not a merge - confirm first
    // since it replaces whatever's currently selected.
    if (Object.keys(selections).length > 0) {
      const confirmed = window.confirm('Importing will replace your current selections. Continue?')
      if (!confirmed) return
    }

    const knownRefKeys = new Set(rows.map((row) => refKey(row.ref)))
    const { selections: imported, unresolvedRefs } = resolveImportedSelections(validation.file, knownRefKeys)
    setAllSelections(imported)

    setMessage(
      unresolvedRefs.length > 0
        ? `Imported. ${unresolvedRefs.length} rule(s) from the file no longer exist and were skipped: ${unresolvedRefs
            .map((ref) => ref.id)
            .join(', ')}.`
        : 'Import complete.',
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="xs" onClick={handleExport}>
        Export
      </Button>
      <Button type="button" variant="outline" size="xs" onClick={() => fileInputRef.current?.click()}>
        Import
      </Button>
      {/* Left as a raw input, not the shadcn Input wrapper: it's driven by a
          direct ref.click() call and there's no guarantee a wrapper
          component forwards the ref/click the same way a real <input> does. */}
      <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleFileChosen} />
      {message && (
        <span role="status" className="text-xs text-slate-500">
          {message}
        </span>
      )}
    </div>
  )
}
