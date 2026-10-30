import type { Availability, CatalogIndex, CatalogProduct } from '../types/catalog'
import type { EffectiveInclusion } from './catalogTree'

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  included: 'Included',
  add_on: 'Add-on',
}

export interface CatalogLookup {
  productsById: Map<string, CatalogProduct>
  licencesById: Map<string, { id: string; title: string }>
}

export function buildCatalogLookup(index: CatalogIndex): CatalogLookup {
  const productsById = new Map(index.products.map((product) => [product.id, product]))
  const licencesById = new Map(index.licences.map((licence) => [licence.id, { id: licence.id, title: licence.title }]))
  return { productsById, licencesById }
}

// The licence the outer licence itself contains that brings the product in,
// or null for a product the outer licence lists directly. This is the first
// hop rather than the licence that lists the product, because tiers nest:
// E5 contains Entra ID P2, which contains P1, so a product P1 lists reads
// "via Entra ID P2" in E5 and "via Entra ID P1" in E3, not P1 in both.
export function supplyingLicenceIdOf(inclusion: EffectiveInclusion): string | null {
  return inclusion.viaLicenceIds[0] ?? null
}

export interface InclusionRoute {
  availability: Availability
  sourceLicenceId: string | null
}

// Routes that differ only past their first hop read the same, so each
// availability and supplying licence pair is listed once, in first-seen order.
export function distinctRoutesOf(inclusions: EffectiveInclusion[]): InclusionRoute[] {
  const routesByKey = new Map<string, InclusionRoute>()
  for (const inclusion of inclusions) {
    const route = { availability: inclusion.availability, sourceLicenceId: supplyingLicenceIdOf(inclusion) }
    const routeKey = `${route.availability}\u0000${route.sourceLicenceId ?? ''}`
    if (!routesByKey.has(routeKey)) routesByKey.set(routeKey, route)
  }
  return [...routesByKey.values()]
}

export function availabilityText(availability: Availability, sourceLicenceId: string | null | undefined, lookup: CatalogLookup): string {
  if (sourceLicenceId === null || sourceLicenceId === undefined) return AVAILABILITY_LABELS[availability]
  const title = lookup.licencesById.get(sourceLicenceId)?.title ?? sourceLicenceId
  return `${AVAILABILITY_LABELS[availability]} via ${title}`
}

export interface RequiredProductLabel {
  // The product to link to; null when the catalog does not have it.
  productId: string | null
  title: string
}

// An unknown product falls back to its id.
export function requiredProductLabelOf(requiredId: string, lookup: CatalogLookup): RequiredProductLabel {
  const product = lookup.productsById.get(requiredId)
  if (product === undefined) return { productId: null, title: requiredId }
  return { productId: product.id, title: product.title }
}
