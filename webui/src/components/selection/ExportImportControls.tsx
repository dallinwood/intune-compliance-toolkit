import { useRef, useState, type ChangeEvent } from 'react'
import { Button } from '@/components/ui/button'
import { fetchRule } from '../../data/ruleDetail'
import {
  buildSettingsFile,
  importedIdsWithOdvValues,
  sanitizeImportedSelections,
  serializeSettingsFile,
  validateSettingsFile,
  type ImportSanitization,
} from '../../logic/exportImport'
import { useSelectionStore } from '../../state/selectionStore'
import type { ManifestSource, Rule } from '../../types/library'
import type { RuleRow } from '../../types/rule-row'

interface ImportMessage {
  summary: string
  details: string[]
  isError: boolean
}

function describeImport(result: ImportSanitization): ImportMessage {
  const importedCount = Object.keys(result.selections).length
  const details: string[] = []
  if (result.unknownIds.length > 0) {
    details.push(`Skipped ${result.unknownIds.length} rule(s) not in this library: ${result.unknownIds.join(', ')}.`)
  }
  if (result.duplicateIds.length > 0) {
    details.push(`Listed more than once, so the last entry was used: ${result.duplicateIds.join(', ')}.`)
  }
  for (const dropped of result.droppedValues) {
    details.push(`Value for ${dropped.id} not imported: ${dropped.reason}`)
  }
  return { summary: `Imported ${importedCount} rule selection(s).`, details, isError: false }
}

async function fetchRulesById(ids: string[], rowsById: ReadonlyMap<string, RuleRow>): Promise<Map<string, Rule>> {
  const rulesById = new Map<string, Rule>()
  // allSettled: a rule that fails to load is simply absent from the map, and
  // the sanitizer drops its value with a reason instead of failing the
  // whole import.
  await Promise.allSettled(
    ids.map(async (id) => {
      const row = rowsById.get(id)
      // Always fetch through the library's own ref, never a path from the file.
      if (row) rulesById.set(id, await fetchRule(row.ref))
    }),
  )
  return rulesById
}

export function ExportImportControls({ rows, sources }: { rows: RuleRow[]; sources: ManifestSource[] }) {
  const selections = useSelectionStore((store) => store.selections)
  const setAllSelections = useSelectionStore((store) => store.setAllSelections)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<ImportMessage | null>(null)

  function handleExport() {
    const libraryReleases = Object.fromEntries(sources.map((source) => [source.name, source.release_tag]))
    const file = buildSettingsFile(selections, new Date().toISOString(), libraryReleases)
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
      setMessage({ summary: 'That file is not valid JSON.', details: [], isError: true })
      return
    }

    const validation = validateSettingsFile(parsed)
    if (!validation.valid) {
      setMessage({ summary: validation.error, details: [], isError: true })
      return
    }

    // Import is a "load this snapshot" action, not a merge - confirm first
    // since it replaces whatever's currently selected.
    if (Object.keys(selections).length > 0) {
      const confirmed = window.confirm('Importing will replace your current selections. Continue?')
      if (!confirmed) return
    }

    const entries = validation.file.selections
    const rowsById = new Map(rows.map((row) => [row.ref.id, row]))
    const rulesById = await fetchRulesById(importedIdsWithOdvValues(entries, rowsById), rowsById)
    const result = sanitizeImportedSelections(entries, rowsById, rulesById)
    setAllSelections(result.selections)
    setMessage(describeImport(result))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
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
        <div role="status" className={`max-w-md text-xs ${message.isError ? 'text-destructive' : 'text-muted-foreground'}`}>
          <span>{message.summary}</span>{' '}
          <button type="button" onClick={() => setMessage(null)} className="underline hover:text-foreground">
            Dismiss
          </button>
          {message.details.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-warning-foreground">
              {message.details.map((detail) => (
                <li key={detail} className="break-words">
                  {detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
