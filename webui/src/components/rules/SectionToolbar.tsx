import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface SectionToolbarProps {
  onExpandAll: () => void
  onCollapseAll: () => void
  trailing?: ReactNode
}

export function SectionToolbar({ onExpandAll, onCollapseAll, trailing }: SectionToolbarProps) {
  return (
    <div role="group" aria-label="Sections" className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-4 py-2">
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="xs" onClick={onExpandAll}>
          Expand all
        </Button>
        <Button type="button" variant="outline" size="xs" onClick={onCollapseAll}>
          Collapse all
        </Button>
      </div>
      {trailing && <div className="ml-auto">{trailing}</div>}
    </div>
  )
}
