import { useMemo } from 'react'
import { useSelectionStore } from '../../state/selectionStore'
import type { RuleRow } from '../../types/rule-row'
import { ExportImportControls } from './ExportImportControls'

export function SelectionToolbar({ rows }: { rows: RuleRow[] }) {
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
    </div>
  )
}
