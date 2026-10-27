import type { Availability, CatalogIndex, CatalogProduct } from '../types/catalog'
import { fullPlanId } from './catalogIndex'
import type { EffectiveInclusion } from './catalogTree'

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  included: 'Included',
  add_on: 'Add-on',
  package_feature: 'Package feature',
}

export const AVAILABILITIES: readonly Availability[] = ['included', 'add_on', 'package_feature']

export interface CatalogLookup {
  productsById: Map<string, CatalogProduct>
  planTitlesByFullId: Map<string, string>
}

export function buildCatalogLookup(index: CatalogIndex): CatalogLookup {
  const productsById = new Map(index.products.map((product) => [product.id, product]))
  const planTitlesByFullId = new Map<string, string>()
  for (const product of index.products) {
    for (const plan of product.plans) planTitlesByFullId.set(fullPlanId(product.id, plan.id), plan.title)
  }
  return { productsById, planTitlesByFullId }
}

export interface PlanLabel {
  title: string
  // A level unique to the licence rather than a plan the product defines.
  isCustom: boolean
}

// The plan a direct inclusion names; null for a plan-derived inclusion or one
// that names no plan. An unknown plan id falls back to the id itself.
export function planLabelOf(inclusion: EffectiveInclusion, lookup: CatalogLookup): PlanLabel | null {
  if (inclusion.via === 'plan') return null
  if (inclusion.custom_plan !== undefined) return { title: inclusion.custom_plan.title, isCustom: true }
  if (inclusion.plan === undefined) return null
  const title = lookup.planTitlesByFullId.get(fullPlanId(inclusion.product, inclusion.plan)) ?? inclusion.plan
  return { title, isCustom: false }
}

export function viaPlanTitleOf(inclusion: EffectiveInclusion, lookup: CatalogLookup): string | null {
  if (inclusion.via !== 'plan' || inclusion.viaPlanId === null) return null
  return lookup.planTitlesByFullId.get(inclusion.viaPlanId) ?? inclusion.viaPlanId
}
