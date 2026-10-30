import { useMemo, useState } from 'react'
import { AVAILABILITIES, compareText } from '../../logic/catalogIndex'
import { AVAILABILITY_LABELS, requiredProductLabelOf, type CatalogLookup } from '../../logic/inclusionDisplay'
import { groupLicenceEntries, type LicenceRow } from '../../logic/includedIn'
import { ancestorsOf } from '../../logic/productSearch'
import type { Availability, CatalogIndex, CatalogProduct, ProductLicenceEntry } from '../../types/catalog'
import { TargetIcons } from '../rules/TargetIcons'
import { AvailabilityBadge, SourceRouteList } from './AvailabilityBadge'
import { CatalogLink } from './CatalogLink'
import { RequirementText } from './RequirementText'

const COLLAPSED_FEATURE_COUNT = 12

// One link per line in a responsive grid; long lists show a dozen and a toggle.
function FeatureGrid({ productIds, lookup }: { productIds: string[]; lookup: CatalogLookup }) {
  const [isShowingAll, setIsShowingAll] = useState(false)
  const titleOf = (productId: string) => lookup.productsById.get(productId)?.title ?? productId
  const sortedProductIds = [...productIds].sort((left, right) => compareText(titleOf(left), titleOf(right)))
  const isTruncated = sortedProductIds.length > COLLAPSED_FEATURE_COUNT
  const shownProductIds = isTruncated && !isShowingAll ? sortedProductIds.slice(0, COLLAPSED_FEATURE_COUNT) : sortedProductIds
  return (
    <div>
      <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm md:grid-cols-2 xl:grid-cols-3">
        {shownProductIds.map((productId) => {
          const linked = lookup.productsById.get(productId)
          return (
            <li key={productId} className="break-words">
              {linked === undefined ? (
                productId
              ) : (
                <CatalogLink view="products" id={productId}>
                  {linked.title}
                </CatalogLink>
              )}
            </li>
          )
        })}
      </ul>
      {isTruncated && (
        <button
          type="button"
          aria-expanded={isShowingAll}
          onClick={() => setIsShowingAll(!isShowingAll)}
          className="mt-2 rounded text-sm text-link hover:underline focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
        >
          {isShowingAll ? 'Show fewer' : `Show all ${sortedProductIds.length}`}
        </button>
      )}
    </div>
  )
}

// The group heading already names the availability, so route lines only name the licence.
function EntryLine({ row, licenceTitle, lookup, availability }: { row: LicenceRow; licenceTitle: string; lookup: CatalogLookup; availability: Availability }) {
  return (
    <li className="py-2">
      <CatalogLink view="licences" id={row.licence} className="text-sm font-medium break-words">
        {licenceTitle}
      </CatalogLink>
      {row.supplyingLicenceIds.length > 0 && (
        <SourceRouteList
          routes={row.supplyingLicenceIds.map((licenceId) => ({ availability, sourceLicenceId: licenceId }))}
          showsAvailability={false}
          lookup={lookup}
        />
      )}
      {row.notes.map((note, noteIndex) => (
        <p key={`${noteIndex}-${note}`} className="text-xs break-words text-muted-foreground">
          {note}
        </p>
      ))}
    </li>
  )
}

function IncludedIn({ entries, catalog, lookup }: { entries: ProductLicenceEntry[]; catalog: CatalogIndex; lookup: CatalogLookup }) {
  const licenceTitles = useMemo(() => new Map(catalog.licences.map((licence) => [licence.id, licence.title])), [catalog.licences])
  const titleOf = (row: LicenceRow) => licenceTitles.get(row.licence) ?? row.licence
  const rowsByAvailability = (availability: Availability) =>
    groupLicenceEntries(entries.filter((entry) => entry.availability === availability)).sort((left, right) => compareText(titleOf(left), titleOf(right)))

  return (
    <section aria-label="Included in" className="space-y-3">
      <h3 className="text-sm font-semibold">Included in</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No licence in the catalog includes this directly. It may come with a parent product.</p>
      ) : (
        AVAILABILITIES.map((availability) => {
          const group = rowsByAvailability(availability)
          if (group.length === 0) return null
          return (
            <div key={availability} role="group" aria-label={AVAILABILITY_LABELS[availability]} className="rounded border border-border">
              <div className="border-b border-border bg-muted px-3 py-2">
                <AvailabilityBadge availability={availability} />
              </div>
              <ul className="divide-y divide-border px-3">
                {group.map((row) => (
                  <EntryLine key={row.licence} row={row} licenceTitle={titleOf(row)} lookup={lookup} availability={availability} />
                ))}
              </ul>
            </div>
          )
        })
      )}
    </section>
  )
}

export function ProductDetail({ product, catalog, lookup }: { product: CatalogProduct; catalog: CatalogIndex; lookup: CatalogLookup }) {
  const ancestors = useMemo(() => ancestorsOf(product, lookup.productsById), [product, lookup])
  const childIds = useMemo(
    () =>
      catalog.products
        .filter((candidate) => candidate.parent === product.id)
        .sort((left, right) => compareText(left.title, right.title) || compareText(left.id, right.id))
        .map((child) => child.id),
    [catalog.products, product.id],
  )
  const vendorTitle = catalog.vendors.find((vendor) => vendor.id === product.vendor)?.title ?? product.vendor

  return (
    <div className="space-y-4 p-4">
      <header className="space-y-2">
        {ancestors.length > 0 && (
          <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
            <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              {ancestors.map((ancestor) => (
                <li key={ancestor.id} className="flex items-center gap-1.5">
                  <CatalogLink view="products" id={ancestor.id} className="break-words">
                    {ancestor.title}
                  </CatalogLink>
                  <span aria-hidden="true">›</span>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold break-words">{product.title}</h2>
          <TargetIcons targetKeys={product.targets} />
        </div>
        <p className="text-sm text-muted-foreground">{vendorTitle}</p>
        {product.description !== null && <p className="text-sm break-words">{product.description}</p>}
        {product.requires !== null && (
          <p className="text-sm break-words">
            <span className="text-muted-foreground">Requires: </span>
            <RequirementText
              requirement={product.requires}
              renderId={(requiredId) => {
                const label = requiredProductLabelOf(requiredId, lookup)
                return label.productId === null ? (
                  label.title
                ) : (
                  <CatalogLink view="products" id={label.productId}>
                    {label.title}
                  </CatalogLink>
                )
              }}
            />
          </p>
        )}
        {product.links.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {product.links.map((link) => (
              <li key={link.url}>
                <a href={link.url} target="_blank" rel="noreferrer" className="text-link underline-offset-2 hover:underline">
                  {link.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </header>

      {childIds.length > 0 && (
        <section aria-label="Features">
          <h3 className="text-sm font-semibold">Features</h3>
          <FeatureGrid productIds={childIds} lookup={lookup} />
        </section>
      )}

      <IncludedIn entries={catalog.by_product[product.id] ?? []} catalog={catalog} lookup={lookup} />
    </div>
  )
}
