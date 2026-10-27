import type { MouseEvent, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { hrefForCatalogEntry, useFilterStore } from '../../state/filterStore'

function isPlainLeftClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

// A link to a licence or product in its own tab. The href works in a new tab
// or when copied; a plain click switches tab without reloading.
export function CatalogLink({
  view,
  id,
  className,
  isCurrent = false,
  onNavigate,
  children,
}: {
  view: 'licences' | 'products'
  id: string
  className?: string
  isCurrent?: boolean
  // Runs on a plain click instead of the default tab switch.
  onNavigate?: () => void
  children: ReactNode
}) {
  const filterState = useFilterStore()
  return (
    <a
      href={hrefForCatalogEntry(filterState, view, id)}
      onClick={(event) => {
        if (!isPlainLeftClick(event)) return
        event.preventDefault()
        if (onNavigate !== undefined) {
          onNavigate()
          return
        }
        if (view === 'licences') filterState.setLicence(id)
        else filterState.setProduct(id)
        filterState.setView(view)
      }}
      aria-current={isCurrent ? 'true' : undefined}
      className={cn('text-link underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none', className)}
    >
      {children}
    </a>
  )
}
