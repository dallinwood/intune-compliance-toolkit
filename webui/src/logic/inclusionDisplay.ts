import type { Availability, CatalogIndex, CatalogProduct } from '../types/catalog'
import { fullPlanId } from './catalogIndex'
import type { EffectiveInclusion } from './catalogTree'

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  included: 'Included',
  add_on: 'Add-on',
}

export interface CatalogLookup {
  productsById: Map<string, CatalogProduct>
  licencesById: Map<string, { id: string; title: string }>
  planTitlesByFullId: Map<string, string>
}

export function buildCatalogLookup(index: CatalogIndex): CatalogLookup {
  const productsById = new Map(index.products.map((product) => [product.id, product]))
  const licencesById = new Map(index.licences.map((licence) => [licence.id, { id: licence.id, title: licence.title }]))
  const planTitlesByFullId = new Map<string, string>()
  for (const product of index.products) {
    for (const plan of product.plans) planTitlesByFullId.set(fullPlanId(product.id, plan.id), plan.title)
  }
  return { productsById, licencesById, planTitlesByFullId }
}

export function availabilityText(availability: Availability, sourceId: string | null | undefined, lookup: CatalogLookup): string {
  if (sourceId === null || sourceId === undefined) return AVAILABILITY_LABELS[availability]
  const title = lookup.licencesById.get(sourceId)?.title ?? lookup.productsById.get(sourceId)?.title ?? sourceId
  return `${AVAILABILITY_LABELS[availability]} via ${title}`
}

export interface PlanLabel {
  title: string
  // A level unique to the licence rather than a plan the product defines.
  isCustom: boolean
}

// The plan a direct inclusion names; null for a plan-derived inclusion or one
// that names no plan. An unknown plan id falls back to the id itself.
export function planLabelOf(inclusion: EffectiveInclusion, lookup: CatalogLookup): PlanLabel | null {
  if (inclusion.type !== 'product') return null
  if (inclusion.via === 'plan') return null
  if (inclusion.custom_plan !== undefined) return { title: inclusion.custom_plan.title, isCustom: true }
  if (inclusion.plan === undefined) return null
  const title = lookup.planTitlesByFullId.get(fullPlanId(inclusion.target, inclusion.plan)) ?? inclusion.plan
  return { title, isCustom: false }
}

export function viaPlanTitleOf(inclusion: EffectiveInclusion, lookup: CatalogLookup): string | null {
  if (inclusion.viaPlanId === null) return null
  return lookup.planTitlesByFullId.get(inclusion.viaPlanId) ?? inclusion.viaPlanId
}

export interface RequiredProductLabel {
  // The product to link to; null when the catalog does not have it.
  productId: string | null
  title: string
}

// A product requirement names a product id or a full plan id (product ids
// hold exactly one dot). An unknown product or plan falls back to the id.
export function requiredProductLabelOf(requiredId: string, lookup: CatalogLookup): RequiredProductLabel {
  const [vendorId, slug, planId] = requiredId.split('.')
  const productId = `${vendorId}.${slug}`
  const product = lookup.productsById.get(productId)
  if (product === undefined) return { productId: null, title: requiredId }
  if (planId === undefined) return { productId, title: product.title }
  const planTitle = lookup.planTitlesByFullId.get(requiredId)
  return { productId, title: planTitle === undefined ? requiredId : `${product.title} ${planTitle}` }
}
