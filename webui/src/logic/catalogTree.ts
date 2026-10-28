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

export const OTHER_CATEGORY = 'Other'

// Every listed entry, plus the features of every listed plan. A product listed
// directly wins over the same product arriving through a plan.
export function effectiveInclusions(licence: CatalogLicence, productsById: Map<string, CatalogProduct>): EffectiveInclusion[] {
  const directInclusions = licence.includes.map((inclusion): EffectiveInclusion => ({ ...inclusion, via: 'direct', viaPlanId: null }))
  const planInclusions = planDerivedFeatures(licence, productsById).map(
    ({ featureId, viaPlanId, inclusion }): EffectiveInclusion => ({
      product: featureId,
      availability: inclusion.availability,
      package: inclusion.package,
      note: inclusion.note,
      via: 'plan',
      viaPlanId,
    }),
  )
  return [...directInclusions, ...planInclusions]
}

// The product's parent chain from its top-level ancestor down to the product
// itself. A missing parent or a parent cycle ends the chain instead of looping.
export function ancestorChain(product: CatalogProduct, productsById: Map<string, CatalogProduct>): CatalogProduct[] {
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

export function topLevelAncestor(productId: string, productsById: Map<string, CatalogProduct>): CatalogProduct {
  const product = productsById.get(productId)
  if (product === undefined) throw new Error(`Unknown product ${productId}`)
  return ancestorChain(product, productsById)[0]
}

export function categoryOf(productId: string, productsById: Map<string, CatalogProduct>): string {
  return topLevelAncestor(productId, productsById).category ?? OTHER_CATEGORY
}

export function compareProducts(left: CatalogProduct, right: CatalogProduct): number {
  return compareText(left.title, right.title) || compareText(left.id, right.id)
}

// Sorts the nodes and every level beneath them in place.
export function sortNodes<Node extends { product: CatalogProduct; children: Node[] }>(nodes: Node[]): Node[] {
  nodes.sort((left, right) => compareProducts(left.product, right.product))
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
