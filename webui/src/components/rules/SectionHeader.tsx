import { DisclosureChevron } from '@/components/ui/disclosure-chevron'

// Tailwind only sees literal class names, so each level's classes are spelled out.
const SECTION_LEVEL_STYLES: Record<number, string> = {
  1: 'bg-section-1 font-semibold',
  2: 'bg-section-2 font-medium',
  3: 'bg-section-3 font-medium',
}
const SECTION_LEVEL_INDENTS: Record<number, string> = { 1: 'pl-4', 2: 'pl-8', 3: 'pl-12' }
const HEADING_TAGS = { 1: 'h2', 2: 'h3', 3: 'h4' } as const

// A collapsible group header: chevron, title and count. The rule table's
// sections and a release comparison's groups both use it.
export function SectionHeader({
  id,
  label,
  count,
  depth,
  isOpen,
  onToggle,
}: {
  id: string
  label: string
  count: number
  depth: number
  isOpen: boolean
  onToggle: (id: string) => void
}) {
  const level = Math.min(depth, 3) as 1 | 2 | 3
  const HeadingTag = HEADING_TAGS[level]
  return (
    <HeadingTag className={`border-b border-border text-sm text-section-foreground ${SECTION_LEVEL_STYLES[level]}`}>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => onToggle(id)}
        className={`flex w-full items-center gap-1.5 py-2 pr-4 text-left hover:bg-foreground/5 ${SECTION_LEVEL_INDENTS[level]}`}
      >
        <DisclosureChevron isOpen={isOpen} className="text-section-muted-foreground" />
        <span>
          {label} <span className="font-normal text-section-muted-foreground">({count})</span>
        </span>
      </button>
    </HeadingTag>
  )
}
