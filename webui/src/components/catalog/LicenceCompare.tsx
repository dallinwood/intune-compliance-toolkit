import { useMemo, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { AVAILABILITIES } from '../../logic/catalogIndex'
import { compareRows, withoutIdenticalRows } from '../../logic/licenceCompare'
import { availabilityText, planLabelOf, viaPlanTitleOf, type CatalogLookup } from '../../logic/inclusionDisplay'
import type { EffectiveInclusion } from '../../logic/catalogTree'
import type { CatalogLicence } from '../../types/catalog'
import { AvailabilityBadgeIcon } from './AvailabilityBadge'
import { CatalogLink } from './CatalogLink'

const INDENT_REM_PER_LEVEL = 1
const STICKY_FIRST_COLUMN = 'sticky left-0 z-10 bg-background'

function Cell({ inclusion, lookup }: { inclusion: EffectiveInclusion | null; lookup: CatalogLookup }) {
  if (inclusion === null) {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden="true">-</span>
        <span className="sr-only">Not included</span>
      </span>
    )
  }
  const planTitle = planLabelOf(inclusion, lookup)?.title ?? viaPlanTitleOf(inclusion, lookup)
  const text = availabilityText(inclusion.availability, inclusion.package, lookup)
  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <AvailabilityBadgeIcon availability={inclusion.availability} title={text} />
      <span className="sr-only">{text}</span>
      {planTitle !== null && <span className="text-xs text-muted-foreground">{planTitle}</span>}
    </span>
  )
}

export function LicenceCompare({
  licences,
  lookup,
  onOpenLicence,
}: {
  licences: CatalogLicence[]
  lookup: CatalogLookup
  onOpenLicence: (licenceId: string) => void
}) {
  const [hideIdentical, setHideIdentical] = useState(true)
  const rows = useMemo(() => compareRows(licences, lookup.productsById), [licences, lookup])
  const visibleRows = useMemo(() => (hideIdentical ? withoutIdenticalRows(rows) : rows), [rows, hideIdentical])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Compare licences</h2>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={hideIdentical} onCheckedChange={(checked) => setHideIdentical(checked)} />
          Hide identical rows
        </label>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {visibleRows.length} of {rows.length} rows
      </p>
      <ul aria-label="Legend" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {AVAILABILITIES.map((availability) => (
          <li key={availability} className="flex items-center gap-1.5">
            <AvailabilityBadgeIcon availability={availability} />
            {availabilityText(availability, null, lookup)}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-flex size-6 items-center justify-center">
            -
          </span>
          Not included
        </li>
      </ul>
      <div className="min-h-0 flex-1 overflow-auto rounded border border-border">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th scope="col" className={`${STICKY_FIRST_COLUMN} top-0 z-20 border-b border-border px-3 py-2 text-left font-medium`}>
                Product
              </th>
              {licences.map((licence) => (
                <th key={licence.id} scope="col" className="sticky top-0 z-10 min-w-32 border-b border-border bg-background px-3 py-2 text-center font-medium">
                  <CatalogLink view="licences" id={licence.id} onNavigate={() => onOpenLicence(licence.id)}>
                    {licence.title}
                  </CatalogLink>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.product.id}>
                <th
                  scope="row"
                  className={`${STICKY_FIRST_COLUMN} min-w-48 border-b border-border px-3 py-1.5 text-left font-normal`}
                  style={{ paddingLeft: `${0.75 + row.depth * INDENT_REM_PER_LEVEL}rem` }}
                >
                  <CatalogLink view="products" id={row.product.id}>
                    {row.product.title}
                  </CatalogLink>
                </th>
                {row.cells.map((inclusion, position) => (
                  <td key={licences[position].id} className="relative border-b border-border px-3 py-1.5 text-center align-middle">
                    <Cell inclusion={inclusion} lookup={lookup} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
