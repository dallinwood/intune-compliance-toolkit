import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { InclusionNode } from '../../logic/catalogTree'
import { distinctRoutesOf, type CatalogLookup } from '../../logic/inclusionDisplay'
import { AvailabilityBadge, SourceRouteList } from './AvailabilityBadge'
import { CatalogLink } from './CatalogLink'

const INDENT_REM_PER_LEVEL = 1.25

function InclusionRow({
  node,
  depth,
  lookup,
  collapsedIds,
  onToggle,
}: {
  node: InclusionNode
  depth: number
  lookup: CatalogLookup
  collapsedIds: ReadonlySet<string>
  onToggle: (productId: string) => void
}) {
  const isContextOnly = node.inclusions.length === 0
  const hasChildren = node.children.length > 0
  const isCollapsed = collapsedIds.has(node.product.id)
  // Several routes to one product often carry the same note; show it once.
  const notes = [...new Set(node.inclusions.flatMap((inclusion) => (inclusion.note === null ? [] : [inclusion.note])))]
  const routes = distinctRoutesOf(node.inclusions)
  const availabilities = new Set(routes.map((route) => route.availability))
  // One badge beside the title when every route agrees; otherwise each route line carries its own.
  const sharedAvailability = availabilities.size === 1 ? routes[0].availability : null
  const showsRouteList = availabilities.size > 1 || routes.some((route) => route.sourceLicenceId !== null)

  return (
    <li>
      <div className="flex items-start gap-1 py-1" style={{ paddingLeft: `${depth * INDENT_REM_PER_LEVEL}rem` }}>
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.product.id)}
            aria-expanded={!isCollapsed}
            aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${node.product.title}`}
            className="-mt-1.5 -mr-2 -mb-2 -ml-2 flex shrink-0 items-center rounded p-2 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
          >
            {isCollapsed ? <ChevronRight className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
          </button>
        ) : (
          <span className="size-4 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <CatalogLink view="products" id={node.product.id} className={`text-sm break-words ${isContextOnly ? 'text-muted-foreground' : 'font-medium'}`}>
              {node.product.title}
            </CatalogLink>
            {sharedAvailability !== null && <AvailabilityBadge availability={sharedAvailability} />}
          </div>
          {showsRouteList && <SourceRouteList routes={routes} showsAvailability={sharedAvailability === null} lookup={lookup} />}
          {notes.map((note, noteIndex) => (
            <p key={`${noteIndex}-${note}`} className="text-xs text-muted-foreground">
              {note}
            </p>
          ))}
        </div>
      </div>
      {hasChildren && !isCollapsed && (
        <ul>
          {node.children.map((child) => (
            <InclusionRow key={child.product.id} node={child} depth={depth + 1} lookup={lookup} collapsedIds={collapsedIds} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function InclusionTree({ roots, lookup }: { roots: InclusionNode[]; lookup: CatalogLookup }) {
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set())
  const toggle = (productId: string) =>
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })

  return (
    <ul>
      {roots.map((root) => (
        <InclusionRow key={root.product.id} node={root} depth={0} lookup={lookup} collapsedIds={collapsedIds} onToggle={toggle} />
      ))}
    </ul>
  )
}
