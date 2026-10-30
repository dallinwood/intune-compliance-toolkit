import { Check, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { Availability } from '../../types/catalog'
import { AVAILABILITY_LABELS, type CatalogLookup, type InclusionRoute } from '../../logic/inclusionDisplay'
import { CatalogLink } from './CatalogLink'

const AVAILABILITY_ICONS = { included: Check, add_on: Plus } as const

const AVAILABILITY_STYLES: Record<Availability, string> = {
  included: 'bg-success text-success-foreground',
  add_on: 'border-border text-foreground',
}

// The icon and the label both carry the meaning, so colour is never the only cue.
export function AvailabilityBadge({ availability }: { availability: Availability }) {
  const Icon = AVAILABILITY_ICONS[availability]
  return (
    <Badge variant="outline" className={AVAILABILITY_STYLES[availability]}>
      <Icon aria-hidden="true" />
      {AVAILABILITY_LABELS[availability]}
    </Badge>
  )
}

function SourceText({ sourceLicenceId, lookup }: { sourceLicenceId: string | null; lookup: CatalogLookup }) {
  if (sourceLicenceId === null) return <span>directly</span>
  const sourceLicence = lookup.licencesById.get(sourceLicenceId)
  return (
    <span className="break-words">
      via{' '}
      {sourceLicence === undefined ? (
        sourceLicenceId
      ) : (
        <CatalogLink view="licences" id={sourceLicenceId}>
          {sourceLicence.title}
        </CatalogLink>
      )}
    </span>
  )
}

// One line per route, stacked under the item, so several sources read as
// alternatives rather than as a chain of licences.
export function SourceRouteList({ routes, showsAvailability, lookup }: { routes: InclusionRoute[]; showsAvailability: boolean; lookup: CatalogLookup }) {
  return (
    <ul className="mt-1 space-y-1 border-l-2 border-border pl-2.5 text-xs text-muted-foreground">
      {routes.map((route) => (
        <li key={`${route.availability}-${route.sourceLicenceId ?? ''}`} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {showsAvailability && <AvailabilityBadge availability={route.availability} />}
          <SourceText sourceLicenceId={route.sourceLicenceId} lookup={lookup} />
        </li>
      ))}
    </ul>
  )
}

const AVAILABILITY_ICON_STYLES: Record<Availability, string> = {
  included: 'bg-success text-success-foreground',
  add_on: 'border border-control-border text-foreground',
}

// Icon only, for a table cell; the label is the hover title and the caller adds
// it for screen readers.
export function AvailabilityBadgeIcon({ availability, title = AVAILABILITY_LABELS[availability] }: { availability: Availability; title?: string }) {
  const Icon = AVAILABILITY_ICONS[availability]
  return (
    <span title={title} className={`inline-flex size-6 items-center justify-center rounded-full ${AVAILABILITY_ICON_STYLES[availability]}`}>
      <Icon aria-hidden="true" className="size-3.5" />
    </span>
  )
}
