import { VIEWS } from '../../views/viewRegistry'
import { hrefForView, useFilterStore } from '../../state/filterStore'

export function ViewTabs({ activeViewId }: { activeViewId: string }) {
  const filterState = useFilterStore()

  return (
    <nav aria-label="Views" className="overflow-x-auto border-b border-border px-4">
      <ul className="flex min-w-max gap-1">
        {VIEWS.map((view) => {
          const isActive = view.id === activeViewId
          return (
            <li key={view.id}>
              <a
                href={hrefForView(filterState, view.id)}
                aria-current={isActive ? 'page' : undefined}
                onClick={(event) => {
                  const isPlainLeftClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
                  if (!isPlainLeftClick) return
                  event.preventDefault()
                  if (!isActive) filterState.setView(view.id)
                }}
                className={`-mb-px inline-block border-b-2 px-3 py-2 text-sm whitespace-nowrap focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none ${
                  isActive
                    ? 'border-link font-medium text-link'
                    : 'border-transparent text-muted-foreground hover:border-control-border hover:text-foreground'
                }`}
              >
                {view.label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
