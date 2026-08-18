import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
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
        <Button type="button" variant="link" size="xs" onClick={clearAll}>
          Clear selection
        </Button>
      )}
      <ExportImportControls rows={rows} />
      <Button type="button" size="xs" onClick={onGenerate} disabled={selectedCount === 0}>
        Generate
      </Button>
    </div>
  )
}
