import { isPlainLeftClick } from '@/lib/utils'
import { VIEWS } from '../../views/viewRegistry'
import { hrefForView, useFilterStore } from '../../state/filterStore'
import { tabLinkClassName } from './tabLinkClassName'

export function ViewTabs({ activeViewId }: { activeViewId: string }) {
  const filterState = useFilterStore()

  return (
    <div className="border-b border-border px-4">
      {/* Overlapping the border by 1px lets the active underline sit on it; a negative margin on the links instead made the nav scroll vertically. */}
      <nav aria-label="Views" className="-mb-px">
        <ul className="flex flex-wrap gap-x-1">
          {VIEWS.map((view) => {
            const isActive = view.id === activeViewId
            return (
              <li key={view.id}>
                <a
                  href={hrefForView(filterState, view.id)}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={(event) => {
                    if (!isPlainLeftClick(event)) return
                    event.preventDefault()
                    if (!isActive) filterState.setView(view.id)
                  }}
                  className={tabLinkClassName(isActive)}
                >
                  {view.label}
                </a>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
