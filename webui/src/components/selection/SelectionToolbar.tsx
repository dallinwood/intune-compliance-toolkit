import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { useSelectionStore } from '../../state/selectionStore'
import type { ManifestSource } from '../../types/library'
import type { RuleRow } from '../../types/rule-row'
import { ExportImportControls } from './ExportImportControls'

export function SelectionToolbar({
  rows,
  sources,
  onGenerate,
}: {
  rows: RuleRow[]
  sources: ManifestSource[]
  onGenerate: () => void
}) {
  const selections = useSelectionStore((store) => store.selections)
  const clearAll = useSelectionStore((store) => store.clearAll)
  const selectedCount = useMemo(() => Object.values(selections).filter((entry) => entry.enabled).length, [selections])

  return (
    <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
      <span className="font-medium text-slate-700">{selectedCount} selected</span>
      {selectedCount > 0 && (
        <Button type="button" variant="link" size="xs" onClick={clearAll}>
          Clear selection
        </Button>
      )}
      <ExportImportControls rows={rows} sources={sources} />
      <Button type="button" size="xs" onClick={onGenerate} disabled={selectedCount === 0}>
        Generate
      </Button>
    </div>
  )
}
