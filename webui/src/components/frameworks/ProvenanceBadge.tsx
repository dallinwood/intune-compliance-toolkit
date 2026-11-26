import { BadgeCheck, Users, type LucideIcon } from 'lucide-react'
import type { ManifestSource } from '../../types/library'

interface ProvenanceDisplay {
  label: string
  icon: LucideIcon
  colourClassName: string
}

const PROVENANCE_DISPLAY: Record<ManifestSource['provenance'], ProvenanceDisplay> = {
  official: {
    label: 'Official',
    icon: BadgeCheck,
    colourClassName: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  },
  community: {
    label: 'Community',
    icon: Users,
    colourClassName: 'bg-muted text-muted-foreground',
  },
}

// Deliberately borderless, square-cornered and upper-case: every clickable
// control next to it (Rules, Coverage, release links) is a bordered button, so
// a label must not share that look.
export function ProvenanceBadge({ provenance }: { provenance: ManifestSource['provenance'] }) {
  const { label, icon: Icon, colourClassName } = PROVENANCE_DISPLAY[provenance]
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-[11px] font-semibold tracking-wide whitespace-nowrap uppercase select-none ${colourClassName}`}
    >
      <Icon aria-hidden="true" className="size-3" />
      {label}
    </span>
  )
}
