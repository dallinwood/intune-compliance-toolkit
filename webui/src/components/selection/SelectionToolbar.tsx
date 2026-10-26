import { Button } from '@/components/ui/button'
import { useSelectionStore } from '../../state/selectionStore'
import type { ManifestSource } from '../../types/library'
import type { RuleRow } from '../../types/rule-row'
import { ExportImportControls } from './ExportImportControls'

export function SelectionToolbar({
  rows,
  sources,
  selectedCount,
  onGenerate,
}: {
  rows: RuleRow[]
  sources: ManifestSource[]
  // Enabled selections whose rule is in the loaded library.
  selectedCount: number
  onGenerate: () => void
}) {
  const clearAll = useSelectionStore((store) => store.clearAll)

  return (
    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
      <span className="font-medium text-foreground/90">{selectedCount} selected</span>
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
