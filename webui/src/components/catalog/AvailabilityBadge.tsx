import { Check, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { Availability } from '../../types/catalog'
import { AVAILABILITY_LABELS, type CatalogLookup } from '../../logic/inclusionDisplay'
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

// An add-on that needs a bundle says which one, linking to that product; the
// link sits beside the badge because the badge clips long titles.
export function AvailabilityWithPackage({ availability, packageId, lookup }: { availability: Availability; packageId: string | undefined; lookup: CatalogLookup }) {
  if (packageId === undefined) return <AvailabilityBadge availability={availability} />
  const packageProduct = lookup.productsById.get(packageId)
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <AvailabilityBadge availability={availability} />{' '}
      <span className="text-xs text-muted-foreground">
        via{' '}
        {packageProduct === undefined ? (
          packageId
        ) : (
          <CatalogLink view="products" id={packageId} className="break-words">
            {packageProduct.title}
          </CatalogLink>
        )}
      </span>
    </span>
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
