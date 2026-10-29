import { describe, expect, it } from 'vitest'
import type { CatalogProduct, CatalogVendor } from '../types/catalog'
import { productTree, searchProducts } from './productSearch'

function product(id: string, overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return { id, title: id, vendor: 'a', parent: null, requires: null, category: null, description: null, links: [], targets: [], plans: [], ...overrides }
}

const VENDORS: CatalogVendor[] = [
  { id: 'a', title: 'Acme', url: null },
  { id: 'b', title: 'Bolt', url: null },
]

describe('productTree', () => {
  const products = [
    product('a.zeta', { title: 'Zeta', category: 'Security' }),
    product('a.alpha', { title: 'Alpha', category: 'Security' }),
    product('a.alpha.child', { title: 'Child', parent: 'a.alpha' }),
    product('a.misc', { title: 'Misc' }),
    product('b.tool', { title: 'Tool', vendor: 'b', category: 'Apps' }),
  ]

  it('groups by vendor then category, sorted by title, with children nested', () => {
    const tree = productTree(products, VENDORS)

    expect(tree.map((entry) => entry.vendor.id)).toEqual(['a', 'b'])
    expect(tree[0].categories.map((entry) => entry.category)).toEqual(['Other', 'Security'])
    const security = tree[0].categories[1].roots
    expect(security.map((node) => node.product.title)).toEqual(['Alpha', 'Zeta'])
    expect(security[0].children.map((node) => node.product.title)).toEqual(['Child'])
  })

  it('leaves out vendors with no products', () => {
    expect(productTree([product('b.tool', { vendor: 'b' })], VENDORS).map((entry) => entry.vendor.id)).toEqual(['b'])
  })
})

describe('searchProducts', () => {
  const products = [
    product('a.root', { title: 'Defender Suite' }),
    product('a.mid', { title: 'Middle', parent: 'a.root' }),
    product('a.leaf', { title: 'Defender Leaf', parent: 'a.mid' }),
  ]

  it('matches titles case-insensitively and returns ancestors top-down as the path', () => {
    const results = searchProducts(products, 'DEFENDER')

    expect(results.map((result) => result.product.id)).toEqual(['a.leaf', 'a.root'])
    expect(results[0].path.map((ancestor) => ancestor.id)).toEqual(['a.root', 'a.mid'])
    expect(results[1].path).toEqual([])
  })

  it('returns nothing for an empty or blank query', () => {
    expect(searchProducts(products, '')).toEqual([])
    expect(searchProducts(products, '   ')).toEqual([])
  })
})
