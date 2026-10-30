import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { compareText } from '../../logic/catalogIndex'
import type { CatalogIndex, CatalogLicence } from '../../types/catalog'
import { CatalogLink } from './CatalogLink'
import { subgroupKey, useExpandedGroups, vendorGroupKey } from '../../hooks/useExpandedGroups'
import { CollapsibleHeading } from './CollapsibleHeading'

// Lines a licence up with its family heading's text, past that heading's chevron.
const LICENCE_ROW_PADDING = 'pr-4 pl-9'

interface FamilyGroup {
  family: string
  licences: CatalogLicence[]
}

interface VendorGroup {
  vendorId: string
  vendorTitle: string
  families: FamilyGroup[]
}

function groupLicences(catalog: CatalogIndex): VendorGroup[] {
  const vendorTitles = new Map(catalog.vendors.map((vendor) => [vendor.id, vendor.title]))
  const licencesByVendor = new Map<string, CatalogLicence[]>()
  for (const licence of catalog.licences) {
    licencesByVendor.set(licence.vendor, [...(licencesByVendor.get(licence.vendor) ?? []), licence])
  }
  return [...licencesByVendor.entries()]
    .map(([vendorId, vendorLicences]) => {
      const licencesByFamily = new Map<string, CatalogLicence[]>()
      for (const licence of vendorLicences) {
        licencesByFamily.set(licence.family, [...(licencesByFamily.get(licence.family) ?? []), licence])
      }
      const families = [...licencesByFamily.entries()]
        .sort(([left], [right]) => compareText(left, right))
        .map(([family, familyLicences]) => ({
          family,
          licences: [...familyLicences].sort((left, right) => compareText(left.title, right.title) || compareText(left.id, right.id)),
        }))
      return { vendorId, vendorTitle: vendorTitles.get(vendorId) ?? vendorId, families }
    })
    .sort((left, right) => compareText(left.vendorTitle, right.vendorTitle))
}

function groupKeysOf(licence: CatalogLicence): string[] {
  return [vendorGroupKey(licence.vendor), subgroupKey(licence.vendor, licence.family)]
}

function LicenceLabel({ licence }: { licence: CatalogLicence }) {
  return (
    <>
      <span className="min-w-0 break-words">{licence.title}</span>
      {licence.kind === 'add_on' && <Badge variant="outline">Add-on</Badge>}
      {licence.review.length > 0 && (
        <span role="img" aria-label="Needs review" title="Needs review" className="size-2 shrink-0 rounded-full bg-warning-foreground" />
      )}
    </>
  )
}

export function LicenceList({
  catalog,
  selectedLicenceId,
  isComparing,
  compareIds,
  onToggleCompareMode,
  onToggleCompared,
  onShowComparison,
}: {
  catalog: CatalogIndex
  selectedLicenceId: string | null
  isComparing: boolean
  compareIds: string[]
  onToggleCompareMode: () => void
  onToggleCompared: (licenceId: string) => void
  onShowComparison: () => void
}) {
  const groups = useMemo(() => groupLicences(catalog), [catalog])
  const licencesById = useMemo(() => new Map(catalog.licences.map((licence) => [licence.id, licence])), [catalog.licences])
  const { isExpanded, toggle: toggleGroup, expand } = useExpandedGroups(groups.map(({ vendorId }) => vendorGroupKey(vendorId)))
  const [revealedIds, setRevealedIds] = useState('')

  // Vendors start open and families collapsed, except those holding the selection or a ticked
  // licence, including when it changes through navigation; adjusting state
  // during render avoids an extra pass through an effect.
  const idsToReveal = [selectedLicenceId, ...compareIds].filter((id) => id !== null)
  const idsToRevealKey = idsToReveal.join(',')
  if (idsToRevealKey !== revealedIds) {
    setRevealedIds(idsToRevealKey)
    const keysToExpand = idsToReveal.flatMap((id) => {
      const licence = licencesById.get(id)
      return licence === undefined ? [] : groupKeysOf(licence)
    })
    expand(keysToExpand)
  }

  return (
    <nav aria-label="Licences" className="pb-4">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background px-4 py-2">
        <button
          type="button"
          aria-pressed={isComparing}
          onClick={onToggleCompareMode}
          className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none ${
            isComparing ? 'border-primary bg-primary text-primary-foreground' : 'border-control-border hover:bg-muted'
          }`}
        >
          {isComparing ? 'Exit compare' : 'Compare'}
        </button>
        {isComparing && (
          <>
            <span className="text-xs text-muted-foreground">
              {compareIds.length >= 2 ? `${compareIds.length} selected` : 'Tick two or more licences to compare.'}
            </span>
            {compareIds.length >= 2 && (
              <button type="button" onClick={onShowComparison} className="rounded-full border border-control-border px-3 py-1 text-xs hover:bg-muted lg:hidden">
                Show comparison
              </button>
            )}
          </>
        )}
      </div>
      {groups.map(({ vendorId, vendorTitle, families }) => (
        <div key={vendorId}>
          <CollapsibleHeading level={3} isExpanded={isExpanded(vendorGroupKey(vendorId))} onToggle={() => toggleGroup(vendorGroupKey(vendorId))} headingClassName="pt-2 text-sm font-semibold">
            {vendorTitle}
          </CollapsibleHeading>
          {isExpanded(vendorGroupKey(vendorId)) &&
            families.map(({ family, licences }) => {
              const isFamilyExpanded = isExpanded(subgroupKey(vendorId, family))
              return (
                <div key={family}>
                  <CollapsibleHeading level={4} isExpanded={isFamilyExpanded} onToggle={() => toggleGroup(subgroupKey(vendorId, family))} headingClassName="text-xs font-medium text-muted-foreground">
                    {family}
                  </CollapsibleHeading>
                  {isFamilyExpanded && (
                    <ul>
                      {licences.map((licence) => {
                        const isSelected = !isComparing && licence.id === selectedLicenceId
                        return (
                          <li key={licence.id}>
                            {isComparing ? (
                              <label className={`flex cursor-pointer items-center gap-2 ${LICENCE_ROW_PADDING} py-1.5 text-sm hover:bg-muted`}>
                                <Checkbox checked={compareIds.includes(licence.id)} onCheckedChange={() => onToggleCompared(licence.id)} aria-label={licence.title} />
                                <LicenceLabel licence={licence} />
                              </label>
                            ) : (
                              <CatalogLink
                                view="licences"
                                id={licence.id}
                                isCurrent={isSelected}
                                className={`flex items-center gap-2 ${LICENCE_ROW_PADDING} py-1.5 text-sm no-underline hover:bg-muted ${isSelected ? 'bg-muted font-medium' : 'text-foreground'}`}
                              >
                                <LicenceLabel licence={licence} />
                              </CatalogLink>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
        </div>
      ))}
    </nav>
  )
}
