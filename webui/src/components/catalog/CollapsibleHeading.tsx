import { DisclosureChevron } from '@/components/ui/disclosure-chevron'
import type { ReactNode } from 'react'

// A vendor, family or category heading that folds the group beneath it.
export function CollapsibleHeading({
  level,
  isExpanded,
  onToggle,
  headingClassName,
  children,
}: {
  level: 3 | 4
  isExpanded: boolean
  onToggle: () => void
  headingClassName: string
  children: ReactNode
}) {
  const Heading = level === 3 ? 'h3' : 'h4'
  return (
    <Heading className={`flex ${headingClassName}`}>
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={onToggle}
        className="-my-1 flex w-full items-center gap-1 px-4 py-2 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
      >
        <DisclosureChevron isOpen={isExpanded} />
        <span className="min-w-0 break-words">{children}</span>
      </button>
    </Heading>
  )
}
