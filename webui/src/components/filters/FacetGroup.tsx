import { useId, useState, type ReactNode } from 'react'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'

interface FacetGroupProps {
  title: string
  selectedCount?: number
  startsOpen?: boolean
  children: ReactNode
}

// A group with a selection is always shown open at first and opens again
// when its selection goes from empty to non-empty, so a filter never hides
// silently; the person may still close it, and the heading then names how
// many are selected. The group's accessible name is what tells two
// checkboxes both labelled "None" apart (Target and Version each have one).
export function FacetGroup({ title, selectedCount = 0, startsOpen = false, children }: FacetGroupProps) {
  const headingId = useId()
  const regionId = useId()
  const [isOpen, setIsOpen] = useState(startsOpen || selectedCount > 0)
  const [previousSelectedCount, setPreviousSelectedCount] = useState(selectedCount)
  if (previousSelectedCount !== selectedCount) {
    setPreviousSelectedCount(selectedCount)
    if (previousSelectedCount === 0 && selectedCount > 0) setIsOpen(true)
  }

  return (
    <div className="mb-3">
      <h2 id={headingId} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={regionId}
          onClick={() => setIsOpen((wasOpen) => !wasOpen)}
          className="flex w-full items-center gap-1 rounded-sm py-1 text-left uppercase focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
        >
          <DisclosureChevron isOpen={isOpen} />
          <span>{title}</span>
          {!isOpen && selectedCount > 0 && <span className="font-normal tracking-normal normal-case">({selectedCount} selected)</span>}
        </button>
      </h2>
      <div id={regionId} role="group" aria-labelledby={headingId} hidden={!isOpen} className="pt-1">
        {children}
      </div>
    </div>
  )
}
