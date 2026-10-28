import type { CatalogProduct, CatalogVendor } from '../types/catalog'
import { compareText } from './catalogIndex'
import { ancestorChain, compareProducts, OTHER_CATEGORY, sortNodes } from './catalogTree'

export interface ProductTreeNode {
  product: CatalogProduct
  children: ProductTreeNode[]
}

export interface ProductTreeVendor {
  vendor: CatalogVendor
  categories: { category: string; roots: ProductTreeNode[] }[]
}

export interface ProductSearchResult {
  product: CatalogProduct
  // Ancestors from the top-level product down to the direct parent.
  path: CatalogProduct[]
}

export function ancestorsOf(product: CatalogProduct, productsById: Map<string, CatalogProduct>): CatalogProduct[] {
  return ancestorChain(product, productsById).slice(0, -1)
}

// The vendors come in separately because a product only carries its vendor id.
// A product whose parent is missing from the catalog is treated as top-level.
export function productTree(products: CatalogProduct[], vendors: CatalogVendor[]): ProductTreeVendor[] {
  const productsById = new Map(products.map((product) => [product.id, product]))
  const nodesById = new Map<string, ProductTreeNode>(products.map((product) => [product.id, { product, children: [] }]))
  const rootsByVendor = new Map<string, ProductTreeNode[]>()

  for (const product of products) {
    const node = nodesById.get(product.id)
    if (node === undefined) continue
    const parentNode = product.parent === null || !productsById.has(product.parent) ? undefined : nodesById.get(product.parent)
    if (parentNode !== undefined) parentNode.children.push(node)
    else rootsByVendor.set(product.vendor, [...(rootsByVendor.get(product.vendor) ?? []), node])
  }

  return vendors
    .filter((vendor) => rootsByVendor.has(vendor.id))
    .map((vendor) => {
      const rootsByCategory = new Map<string, ProductTreeNode[]>()
      for (const root of rootsByVendor.get(vendor.id) ?? []) {
        const category = root.product.category ?? OTHER_CATEGORY
        rootsByCategory.set(category, [...(rootsByCategory.get(category) ?? []), root])
      }
      const categories = [...rootsByCategory.keys()].sort(compareText).map((category) => ({ category, roots: sortNodes(rootsByCategory.get(category) ?? []) }))
      return { vendor, categories }
    })
    .sort((left, right) => compareText(left.vendor.title, right.vendor.title))
}

export function searchProducts(products: CatalogProduct[], query: string): ProductSearchResult[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []
  const productsById = new Map(products.map((product) => [product.id, product]))
  return products
    .filter((product) => product.title.toLowerCase().includes(needle))
    .sort(compareProducts)
    .map((product) => ({ product, path: ancestorsOf(product, productsById) }))
}
