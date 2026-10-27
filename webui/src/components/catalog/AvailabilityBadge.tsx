import { Check, Package, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { Availability } from '../../types/catalog'
import { AVAILABILITY_LABELS } from '../../logic/inclusionDisplay'

const AVAILABILITY_ICONS = { included: Check, add_on: Plus, package_feature: Package } as const

const AVAILABILITY_STYLES: Record<Availability, string> = {
  included: 'bg-success text-success-foreground',
  add_on: 'border-border text-foreground',
  package_feature: 'bg-secondary text-secondary-foreground',
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

const AVAILABILITY_ICON_STYLES: Record<Availability, string> = {
  included: 'bg-success text-success-foreground',
  add_on: 'border border-control-border text-foreground',
  package_feature: 'bg-secondary text-secondary-foreground',
}

// Icon only, for a table cell; the label is the hover title and the caller adds
// it for screen readers.
export function AvailabilityBadgeIcon({ availability }: { availability: Availability }) {
  const Icon = AVAILABILITY_ICONS[availability]
  return (
    <span title={AVAILABILITY_LABELS[availability]} className={`inline-flex size-6 items-center justify-center rounded-full ${AVAILABILITY_ICON_STYLES[availability]}`}>
      <Icon aria-hidden="true" className="size-3.5" />
    </span>
  )
}
