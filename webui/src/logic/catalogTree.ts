import type { CatalogInclusion, CatalogLicence, CatalogProduct } from '../types/catalog'
import { compareText, planDerivedFeatures } from './catalogIndex'

export type EffectiveInclusion = CatalogInclusion & { via: 'direct' | 'plan'; viaPlanId: string | null }

export interface InclusionNode {
  product: CatalogProduct
  // Empty for an ancestor shown only to give its descendants context.
  inclusions: EffectiveInclusion[]
  children: InclusionNode[]
}

export interface InclusionCategory {
  category: string
  roots: InclusionNode[]
}

const OTHER_CATEGORY = 'Other'

// Every listed entry, plus the features of every listed plan. A product listed
// directly wins over the same product arriving through a plan.
export function effectiveInclusions(licence: CatalogLicence, productsById: Map<string, CatalogProduct>): EffectiveInclusion[] {
  const directInclusions = licence.includes.map((inclusion): EffectiveInclusion => ({ ...inclusion, via: 'direct', viaPlanId: null }))
  const planInclusions = planDerivedFeatures(licence, productsById).map(
    ({ featureId, viaPlanId, inclusion }): EffectiveInclusion => ({
      product: featureId,
      availability: inclusion.availability,
      note: inclusion.note,
      via: 'plan',
      viaPlanId,
    }),
  )
  return [...directInclusions, ...planInclusions]
}

export function topLevelAncestor(productId: string, productsById: Map<string, CatalogProduct>): CatalogProduct {
  let current = productsById.get(productId)
  if (current === undefined) throw new Error(`Unknown product ${productId}`)
  const visitedIds = new Set<string>()
  while (current.parent !== null && !visitedIds.has(current.id)) {
    visitedIds.add(current.id)
    const parent = productsById.get(current.parent)
    if (parent === undefined) break
    current = parent
  }
  return current
}

export function categoryOf(productId: string, productsById: Map<string, CatalogProduct>): string {
  return topLevelAncestor(productId, productsById).category ?? OTHER_CATEGORY
}

function ancestorChain(product: CatalogProduct, productsById: Map<string, CatalogProduct>): CatalogProduct[] {
  const chain = [product]
  const visitedIds = new Set([product.id])
  let current = product
  while (current.parent !== null) {
    const parent = productsById.get(current.parent)
    if (parent === undefined || visitedIds.has(parent.id)) break
    visitedIds.add(parent.id)
    chain.unshift(parent)
    current = parent
  }
  return chain
}

function sortNodes(nodes: InclusionNode[]): InclusionNode[] {
  nodes.sort((left, right) => compareText(left.product.title, right.product.title) || compareText(left.product.id, right.product.id))
  for (const node of nodes) sortNodes(node.children)
  return nodes
}

// Inclusions of products the catalog does not have are left out. Categories
// come from each product's top-level ancestor, "Other" when that has none.
export function effectiveInclusionTree(inclusions: EffectiveInclusion[], productsById: Map<string, CatalogProduct>): InclusionCategory[] {
  const nodesById = new Map<string, InclusionNode>()
  const rootsByCategory = new Map<string, InclusionNode[]>()

  for (const inclusion of inclusions) {
    const product = productsById.get(inclusion.product)
    if (product === undefined) continue
    let parentNode: InclusionNode | null = null
    for (const chainProduct of ancestorChain(product, productsById)) {
      let node = nodesById.get(chainProduct.id)
      if (node === undefined) {
        node = { product: chainProduct, inclusions: [], children: [] }
        nodesById.set(chainProduct.id, node)
        if (parentNode === null) {
          const category = categoryOf(chainProduct.id, productsById)
          rootsByCategory.set(category, [...(rootsByCategory.get(category) ?? []), node])
        } else {
          parentNode.children.push(node)
        }
      }
      parentNode = node
    }
    nodesById.get(product.id)?.inclusions.push(inclusion)
  }

  return [...rootsByCategory.keys()]
    .sort(compareText)
    .map((category) => ({ category, roots: sortNodes(rootsByCategory.get(category) ?? []) }))
}
