import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatCount } from '../../lib/format'
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
  const reasonId = useId()
  const hasNothingToGenerate = selectedCount === 0

  return (
    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
      <span className="font-medium text-foreground/90">{formatCount(selectedCount)} selected</span>
      {selectedCount > 0 && (
        <Button type="button" variant="link" size="xs" onClick={clearAll}>
          Clear selection
        </Button>
      )}
      <ExportImportControls rows={rows} sources={sources} />
      <Tooltip disabled={!hasNothingToGenerate}>
        <TooltipTrigger
          render={<span aria-describedby={hasNothingToGenerate ? reasonId : undefined} />}
          tabIndex={hasNothingToGenerate ? 0 : undefined}
          className="inline-flex rounded-4xl focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
        >
          <Button type="button" size="xs" onClick={onGenerate} disabled={hasNothingToGenerate}>
            Generate
          </Button>
        </TooltipTrigger>
        <TooltipContent>Select rules to generate a bundle.</TooltipContent>
      </Tooltip>
      {hasNothingToGenerate && (
        <span id={reasonId} className="sr-only">
          Select rules to generate a bundle.
        </span>
      )}
    </div>
  )
}
