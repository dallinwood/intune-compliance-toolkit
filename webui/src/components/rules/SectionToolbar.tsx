import { Button } from '@/components/ui/button'

interface SectionToolbarProps {
  onExpandOneLevel: () => void
  onCollapseOneLevel: () => void
  onExpandAll: () => void
  onCollapseAll: () => void
}

export function SectionToolbar({ onExpandOneLevel, onCollapseOneLevel, onExpandAll, onCollapseAll }: SectionToolbarProps) {
  return (
    <div role="group" aria-label="Sections" className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2">
      <Button type="button" variant="outline" size="xs" onClick={onExpandOneLevel}>
        Expand one level
      </Button>
      <Button type="button" variant="outline" size="xs" onClick={onCollapseOneLevel}>
        Collapse one level
      </Button>
      <Button type="button" variant="outline" size="xs" onClick={onExpandAll}>
        Expand all
      </Button>
      <Button type="button" variant="outline" size="xs" onClick={onCollapseAll}>
        Collapse all
      </Button>
    </div>
  )
}
