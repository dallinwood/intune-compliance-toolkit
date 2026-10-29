import { describe, expect, it } from 'vitest'
import type { CatalogLicence, CatalogProduct } from '../types/catalog'
import { categoryOf, effectiveInclusionTree, effectiveInclusions, topLevelAncestor } from './catalogTree'

function product(id: string, overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return { id, title: id, vendor: 'a', parent: null, requires: null, category: null, description: null, links: [], targets: [], plans: [], ...overrides }
}

function licence(includes: CatalogLicence['includes']): CatalogLicence {
  return { id: 'a.lic', title: 'Lic', vendor: 'a', family: 'F', kind: 'subscription', requires: null, description: null, links: [], includes, review: [] }
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
    const inclusions = effectiveInclusions(licence([{ type: 'product', target: 'a.root', plan: 'plan_1', availability: 'included', note: null }]), products)

    expect(inclusions.map((inclusion) => `${inclusion.target} ${inclusion.via} ${inclusion.viaPlanId}`)).toEqual([
      'a.root direct null',
      'a.child plan a.root.plan_1',
    ])
  })

  it('lets a direct inclusion win over the same product from a plan', () => {
    const inclusions = effectiveInclusions(
      licence([
        { type: 'product', target: 'a.root', plan: 'plan_1', availability: 'included', note: null },
        { type: 'product', target: 'a.child', availability: 'add_on', note: null },
      ]),
      products,
    )

    expect(inclusions.filter((inclusion) => inclusion.target === 'a.child')).toEqual([
      { type: 'product', target: 'a.child', availability: 'add_on', note: null, via: 'direct', viaPlanId: null, viaLicenceIds: [], viaProductId: null },
    ])
  })
})

describe('effectiveInclusions with plan provenance', () => {
  it('retains the plan source for add-on features', () => {
    const products = byId([
      product('a.suite'),
      product('a.root', { parent: 'a.suite', plans: [{ id: 'plan_1', title: 'P1', description: null, features: ['a.child'] }] }),
      product('a.child', { parent: 'a.root' }),
    ])

    const inclusions = effectiveInclusions(
      licence([
        { type: 'product', target: 'a.suite', availability: 'add_on', note: null },
        { type: 'product', target: 'a.root', plan: 'plan_1', availability: 'add_on', note: null },
      ]),
      products,
    )

    expect(inclusions.map((inclusion) => [inclusion.target, inclusion.availability, inclusion.viaProductId])).toEqual([
      ['a.suite', 'add_on', null],
      ['a.root', 'add_on', null],
      ['a.child', 'add_on', 'a.root'],
    ])
  })
})

describe('effectiveInclusions with two plans sharing a feature', () => {
  it('keeps independently purchasable plan routes to the same feature', () => {
    const products = byId([
      product('a.one', { plans: [{ id: 'plan_1', title: 'P1', description: null, features: ['a.x'] }] }),
      product('a.two', { plans: [{ id: 'plan_1', title: 'P1', description: null, features: ['a.x'] }] }),
      product('a.x'),
    ])

    const inclusions = effectiveInclusions(
      licence([
        { type: 'product', target: 'a.one', plan: 'plan_1', availability: 'included', note: null },
        { type: 'product', target: 'a.two', plan: 'plan_1', availability: 'add_on', note: null },
      ]),
      products,
    )

    const featureInclusions = inclusions.filter((inclusion) => inclusion.target === 'a.x')
    expect(featureInclusions).toHaveLength(2)
    expect(featureInclusions.map((inclusion) => inclusion.viaPlanId)).toEqual(['a.one.plan_1', 'a.two.plan_1'])
  })

})

describe('effectiveInclusions with nested licences', () => {
  it('is cycle-safe when malformed input contains a licence inclusion cycle', () => {
    const root = licence([{ type: 'licence', target: 'a.child', availability: 'included', note: null }])
    const child: CatalogLicence = {
      ...licence([{ type: 'product', target: 'a.child', availability: 'included', note: null }, { type: 'licence', target: 'a.lic', availability: 'included', note: null }]),
      id: 'a.child',
    }

    expect(effectiveInclusions(root, byId([product('a.child')]), new Map([[root.id, root], [child.id, child]])).map((entry) => entry.target)).toEqual(['a.child'])
  })
})

describe('effectiveInclusionTree', () => {
  const products = byId([
    product('a.root', { category: 'Identity' }),
    product('a.child', { parent: 'a.root' }),
    product('a.loose'),
  ])

  it('shows an unlisted ancestor as a context-only node above its included feature', () => {
    const inclusions = effectiveInclusions(licence([{ type: 'product', target: 'a.child', availability: 'included', note: null }]), products)

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
