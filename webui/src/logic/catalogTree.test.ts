import { describe, expect, it } from 'vitest'
import type { CatalogLicence, CatalogProduct } from '../types/catalog'
import { categoryOf, effectiveInclusionTree, effectiveInclusions, topLevelAncestor } from './catalogTree'

function product(id: string, overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return { id, title: id, vendor: 'a', parent: null, requires: null, category: null, description: null, links: [], targets: [], ...overrides }
}

function licence(includes: CatalogLicence['includes'], id = 'a.lic'): CatalogLicence {
  return { id, title: id, vendor: 'a', family: 'F', kind: 'subscription', requires: null, description: null, links: [], includes, review: [] }
}

function byId<Entry extends { id: string }>(entries: Entry[]) {
  return new Map(entries.map((entry) => [entry.id, entry]))
}

describe('effectiveInclusions', () => {
  it('lists a direct product entry with no licence path', () => {
    const inclusions = effectiveInclusions(licence([{ type: 'product', target: 'a.root', availability: 'included', note: null }]))

    expect(inclusions).toEqual([{ type: 'product', target: 'a.root', availability: 'included', note: null, via: 'direct', viaLicenceIds: [] }])
  })

  it('reaches the products of a tier nested in a tier with the full licence path', () => {
    const tierOne = licence([{ type: 'product', target: 'a.identity', availability: 'included', note: null }], 'a.p1')
    const tierTwo = licence(
      [
        { type: 'licence', target: 'a.p1', availability: 'included', note: null },
        { type: 'product', target: 'a.reviews', availability: 'included', note: null },
      ],
      'a.p2',
    )
    const outer = licence([{ type: 'licence', target: 'a.p2', availability: 'included', note: null }])

    const inclusions = effectiveInclusions(outer, byId([tierOne, tierTwo, outer]))

    expect(inclusions.map((inclusion) => [inclusion.target, inclusion.via, inclusion.viaLicenceIds])).toEqual([
      ['a.reviews', 'licence', ['a.p2']],
      ['a.identity', 'licence', ['a.p2', 'a.p1']],
    ])
  })

  it('makes everything in a licence offered as an add-on an add-on, and does not inherit its own add-ons', () => {
    const offered = licence(
      [
        { type: 'product', target: 'a.core', availability: 'included', note: null },
        { type: 'product', target: 'a.extra', availability: 'add_on', note: null },
      ],
      'a.offered',
    )
    const outer = licence([{ type: 'licence', target: 'a.offered', availability: 'add_on', note: 'Bought separately' }])

    expect(effectiveInclusions(outer, byId([offered, outer]))).toEqual([
      { type: 'product', target: 'a.core', availability: 'add_on', note: 'Bought separately', via: 'licence', viaLicenceIds: ['a.offered'] },
    ])
  })

  it('keeps a direct entry and a nested route to the same product as separate routes', () => {
    const inner = licence([{ type: 'product', target: 'a.x', availability: 'included', note: null }], 'a.inner')
    const outer = licence([
      { type: 'product', target: 'a.x', availability: 'add_on', note: null },
      { type: 'licence', target: 'a.inner', availability: 'included', note: null },
    ])

    expect(effectiveInclusions(outer, byId([inner, outer])).map((inclusion) => [inclusion.via, inclusion.availability])).toEqual([
      ['direct', 'add_on'],
      ['licence', 'included'],
    ])
  })

  it('is cycle-safe when malformed input contains a licence inclusion cycle', () => {
    const root = licence([{ type: 'licence', target: 'a.child', availability: 'included', note: null }])
    const child = licence(
      [
        { type: 'product', target: 'a.child', availability: 'included', note: null },
        { type: 'licence', target: 'a.lic', availability: 'included', note: null },
      ],
      'a.child',
    )

    expect(effectiveInclusions(root, byId([root, child])).map((entry) => entry.target)).toEqual(['a.child'])
  })
})

describe('effectiveInclusionTree', () => {
  const products = byId([
    product('a.root', { category: 'Identity' }),
    product('a.child', { parent: 'a.root' }),
    product('a.loose'),
  ])

  it('shows an unlisted ancestor as a context-only node above its included feature', () => {
    const inclusions = effectiveInclusions(licence([{ type: 'product', target: 'a.child', availability: 'included', note: null }]))

    const tree = effectiveInclusionTree(inclusions, products)

    expect(tree).toHaveLength(1)
    expect(tree[0].category).toBe('Identity')
    expect(tree[0].roots[0].product.id).toBe('a.root')
    expect(tree[0].roots[0].inclusions).toEqual([])
    expect(tree[0].roots[0].children[0].product.id).toBe('a.child')
    expect(tree[0].roots[0].children[0].inclusions).toHaveLength(1)
  })

  it('leaves out an inclusion of a product the catalog does not have', () => {
    const inclusions = effectiveInclusions(licence([{ type: 'product', target: 'a.ghost', availability: 'included', note: null }]))

    expect(effectiveInclusionTree(inclusions, products)).toEqual([])
  })

  it('takes the category from the top-level ancestor and names a missing one Other', () => {
    expect(categoryOf('a.child', products)).toBe('Identity')
    expect(categoryOf('a.loose', products)).toBe('Other')
    expect(topLevelAncestor('a.child', products).id).toBe('a.root')
  })
})
