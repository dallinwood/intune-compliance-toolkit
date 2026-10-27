import { describe, expect, it } from 'vitest'
import type { CatalogLicence, CatalogProduct } from '../types/catalog'
import { categoryOf, effectiveInclusionTree, effectiveInclusions, topLevelAncestor } from './catalogTree'

function product(id: string, overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return { id, title: id, vendor: 'a', parent: null, category: null, description: null, links: [], targets: [], plans: [], ...overrides }
}

function licence(includes: CatalogLicence['includes']): CatalogLicence {
  return { id: 'a.lic', title: 'Lic', vendor: 'a', family: 'F', kind: 'subscription', requires: [], description: null, links: [], includes, review: [] }
}

function byId(products: CatalogProduct[]) {
  return new Map(products.map((entry) => [entry.id, entry]))
}

describe('effectiveInclusions', () => {
  const products = byId([
    product('a.root', { plans: [{ id: 'plan_1', title: 'Plan 1', description: null, features: ['a.child'] }] }),
    product('a.child', { parent: 'a.root' }),
  ])

  it('adds the features of a listed plan as plan-derived inclusions', () => {
    const inclusions = effectiveInclusions(licence([{ product: 'a.root', plan: 'plan_1', availability: 'included', note: null }]), products)

    expect(inclusions.map((inclusion) => `${inclusion.product} ${inclusion.via} ${inclusion.viaPlanId}`)).toEqual([
      'a.root direct null',
      'a.child plan a.root.plan_1',
    ])
  })

  it('lets a direct inclusion win over the same product from a plan', () => {
    const inclusions = effectiveInclusions(
      licence([
        { product: 'a.root', plan: 'plan_1', availability: 'included', note: null },
        { product: 'a.child', availability: 'add_on', note: null },
      ]),
      products,
    )

    expect(inclusions.filter((inclusion) => inclusion.product === 'a.child')).toEqual([
      { product: 'a.child', availability: 'add_on', note: null, via: 'direct', viaPlanId: null },
    ])
  })
})

describe('effectiveInclusionTree', () => {
  const products = byId([
    product('a.root', { category: 'Identity' }),
    product('a.child', { parent: 'a.root' }),
    product('a.loose'),
  ])

  it('shows an unlisted ancestor as a context-only node above its included feature', () => {
    const inclusions = effectiveInclusions(licence([{ product: 'a.child', availability: 'included', note: null }]), products)

    const tree = effectiveInclusionTree(inclusions, products)

    expect(tree).toHaveLength(1)
    expect(tree[0].category).toBe('Identity')
    expect(tree[0].roots[0].product.id).toBe('a.root')
    expect(tree[0].roots[0].inclusions).toEqual([])
    expect(tree[0].roots[0].children[0].product.id).toBe('a.child')
    expect(tree[0].roots[0].children[0].inclusions).toHaveLength(1)
  })

  it('takes the category from the top-level ancestor and names a missing one Other', () => {
    expect(categoryOf('a.child', products)).toBe('Identity')
    expect(categoryOf('a.loose', products)).toBe('Other')
    expect(topLevelAncestor('a.child', products).id).toBe('a.root')
  })
})
