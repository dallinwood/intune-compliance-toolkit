import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { compareText } from '../../logic/catalogIndex'
import { AVAILABILITIES, AVAILABILITY_LABELS, type CatalogLookup } from '../../logic/inclusionDisplay'
import { ancestorsOf } from '../../logic/productSearch'
import type { Availability, CatalogIndex, CatalogPlan, CatalogProduct, ProductLicenceEntry } from '../../types/catalog'
import { TargetIcons } from '../rules/TargetIcons'
import { AvailabilityBadge } from './AvailabilityBadge'
import { CatalogLink } from './CatalogLink'

function ProductLinks({ productIds, lookup }: { productIds: string[]; lookup: CatalogLookup }) {
  const titleOf = (productId: string) => lookup.productsById.get(productId)?.title ?? productId
  const sortedProductIds = [...productIds].sort((left, right) => compareText(titleOf(left), titleOf(right)))
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {sortedProductIds.map((productId) => {
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
  )
}

function PlanCard({ plan, lookup }: { plan: CatalogPlan; lookup: CatalogLookup }) {
  return (
    <li className="rounded border border-border p-3">
      <h4 className="text-sm font-medium break-words">{plan.title}</h4>
      {plan.description !== null && <p className="text-sm break-words text-muted-foreground">{plan.description}</p>}
      {plan.features.length > 0 && <ProductLinks productIds={plan.features} lookup={lookup} />}
    </li>
  )
}

function EntryLine({ entry, licenceTitle, lookup }: { entry: ProductLicenceEntry; licenceTitle: string; lookup: CatalogLookup }) {
  const planTitle = entry.planId === null ? null : (lookup.planTitlesByFullId.get(entry.planId) ?? entry.planId)
  const viaPlanTitle = entry.viaPlanId === null ? null : (lookup.planTitlesByFullId.get(entry.viaPlanId) ?? entry.viaPlanId)
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <CatalogLink view="licences" id={entry.licence} className="text-sm font-medium break-words">
          {licenceTitle}
        </CatalogLink>
        {planTitle !== null && <Badge variant="outline">{planTitle}</Badge>}
        {entry.customPlanTitle !== null && (
          <Badge variant="outline" className="italic" title="Specific to this licence">
            {entry.customPlanTitle}
          </Badge>
        )}
        {viaPlanTitle !== null && <span className="text-xs text-muted-foreground">via {viaPlanTitle}</span>}
      </div>
      {entry.note !== null && <p className="text-xs break-words text-muted-foreground">{entry.note}</p>}
    </li>
  )
}

function IncludedIn({ entries, catalog, lookup }: { entries: ProductLicenceEntry[]; catalog: CatalogIndex; lookup: CatalogLookup }) {
  const licenceTitles = useMemo(() => new Map(catalog.licences.map((licence) => [licence.id, licence.title])), [catalog.licences])
  const titleOf = (entry: ProductLicenceEntry) => licenceTitles.get(entry.licence) ?? entry.licence
  const entriesByAvailability = (availability: Availability) =>
    entries.filter((entry) => entry.availability === availability).sort((left, right) => compareText(titleOf(left), titleOf(right)))

  return (
    <section aria-label="Included in" className="space-y-3">
      <h3 className="text-sm font-semibold">Included in</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No licence in the catalog includes this directly. It may come with a parent product.</p>
      ) : (
        AVAILABILITIES.map((availability) => {
          const group = entriesByAvailability(availability)
          if (group.length === 0) return null
          return (
            <div key={availability} role="group" aria-label={AVAILABILITY_LABELS[availability]} className="rounded border border-border">
              <div className="border-b border-border bg-muted px-3 py-2">
                <AvailabilityBadge availability={availability} />
              </div>
              <ul className="divide-y divide-border px-3">
                {group.map((entry) => (
                  <EntryLine
                    key={`${entry.licence}-${entry.planId ?? entry.customPlanTitle ?? entry.viaPlanId ?? ''}`}
                    entry={entry}
                    licenceTitle={titleOf(entry)}
                    lookup={lookup}
                  />
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

      {product.plans.length > 0 && (
        <section aria-label="Plans" className="space-y-2">
          <h3 className="text-sm font-semibold">Plans</h3>
          <ul className="space-y-2">
            {product.plans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} lookup={lookup} />
            ))}
          </ul>
        </section>
      )}

      {childIds.length > 0 && (
        <section aria-label="Features">
          <h3 className="text-sm font-semibold">Features</h3>
          <ProductLinks productIds={childIds} lookup={lookup} />
        </section>
      )}

      <IncludedIn entries={catalog.by_product[product.id] ?? []} catalog={catalog} lookup={lookup} />
    </div>
  )
}
