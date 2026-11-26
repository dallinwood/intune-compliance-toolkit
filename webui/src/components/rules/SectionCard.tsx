import type { ReactNode } from 'react'
import { CustomTag } from './CustomTag'

// One section of a rule's details: a bordered card with its label in a strip
// on the left. The strip becomes a bar across the top when the panel (not the
// viewport) is narrow, because the panel also renders inside dialogs and
// nested mapped-rule panels.
export function SectionCard({
  title,
  custom = false,
  ariaLabel,
  children,
}: {
  title: string
  custom?: boolean
  ariaLabel?: string
  children: ReactNode
}) {
  return (
    <section
      aria-label={ariaLabel}
      className="grid grid-cols-1 overflow-hidden rounded-lg border border-border bg-background @md:grid-cols-[6.5rem_minmax(0,1fr)]"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted px-2.5 py-1.5 @md:flex-col @md:items-start @md:gap-1 @md:border-r @md:border-b-0 @md:py-2.5">
        <h3 className="text-xs font-semibold tracking-wide text-foreground uppercase">{title}</h3>
        {custom && <CustomTag />}
      </div>
      <div className="min-w-0 space-y-2 px-3 py-2.5">{children}</div>
    </section>
  )
}
