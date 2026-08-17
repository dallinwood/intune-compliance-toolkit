import { useMemo } from 'react'
import { useSelectionStore } from '../../state/selectionStore'
import type { RuleRow } from '../../types/rule-row'
import { ExportImportControls } from './ExportImportControls'

export function SelectionToolbar({ rows, onGenerate }: { rows: RuleRow[]; onGenerate: () => void }) {
  const selections = useSelectionStore((store) => store.selections)
  const clearAll = useSelectionStore((store) => store.clearAll)
  const selectedCount = useMemo(() => Object.values(selections).filter((entry) => entry.enabled).length, [selections])

  return (
    <div className="flex items-center gap-4 text-sm text-slate-500">
      <span className="font-medium text-slate-700">{selectedCount} selected</span>
      {selectedCount > 0 && (
        <button type="button" onClick={clearAll} className="text-xs text-slate-500 underline hover:text-slate-700">
          Clear selection
        </button>
      )}
      <ExportImportControls rows={rows} />
      <button
        type="button"
        onClick={onGenerate}
        disabled={selectedCount === 0}
        className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        Generate
      </button>
    </div>
  )
}
