import { describe, expect, it } from 'vitest'
import type { CatalogIndex, CatalogProduct } from '../types/catalog'
import { AVAILABILITIES } from './catalogIndex'
import type { EffectiveInclusion } from './catalogTree'
import { availabilityText, buildCatalogLookup, distinctRoutesOf, requiredProductLabelOf, supplyingLicenceIdOf } from './inclusionDisplay'

function product(id: string, title: string): CatalogProduct {
  return { id, title, vendor: 'a', parent: null, requires: null, category: null, description: null, links: [], targets: [] }
}

const lookup = buildCatalogLookup({
  schema_version: 3,
  vendors: [],
  products: [product('a.suite', 'Teams Premium'), product('a.id', 'Entra ID')],
  licences: [{ id: 'a.p2', title: 'Entra ID P2', vendor: 'a', family: 'F', kind: 'subscription', requires: null, description: null, links: [], includes: [], review: [] }],
  by_product: {},
} satisfies CatalogIndex)

function inclusionThrough(viaLicenceIds: string[]): EffectiveInclusion {
  return { type: 'product', target: 'a.id', availability: 'included', note: null, via: viaLicenceIds.length === 0 ? 'direct' : 'licence', viaLicenceIds }
}

describe('requiredProductLabelOf', () => {
  it('names a product', () => {
    expect(requiredProductLabelOf('a.suite', lookup)).toEqual({ productId: 'a.suite', title: 'Teams Premium' })
  })

  it('falls back to the id for an unknown product', () => {
    expect(requiredProductLabelOf('a.ghost', lookup)).toEqual({ productId: null, title: 'a.ghost' })
  })
})

describe('supplyingLicenceIdOf', () => {
  it('is the first nested licence on the path, not the one that lists the product', () => {
    expect(supplyingLicenceIdOf(inclusionThrough(['a.p2', 'a.p1']))).toBe('a.p2')
  })

  it('is null for a product the licence lists itself', () => {
    expect(supplyingLicenceIdOf(inclusionThrough([]))).toBeNull()
  })
})

describe('distinctRoutesOf', () => {
  it('lists each first hop once, keeping a direct route and differing availabilities apart', () => {
    const addOnThroughP2 = { ...inclusionThrough(['a.p2']), availability: 'add_on' as const }
    const routes = distinctRoutesOf([inclusionThrough(['a.p2', 'a.p1']), inclusionThrough(['a.p2']), inclusionThrough([]), addOnThroughP2])
    expect(routes).toEqual([
      { availability: 'included', sourceLicenceId: 'a.p2' },
      { availability: 'included', sourceLicenceId: null },
      { availability: 'add_on', sourceLicenceId: 'a.p2' },
    ])
  })
})

describe('availabilityText', () => {
  it('names the licence the product comes through', () => {
    expect(availabilityText('included', 'a.p2', lookup)).toBe('Included via Entra ID P2')
  })

  it('falls back to the licence id when the catalog does not have it', () => {
    expect(availabilityText('add_on', 'a.ghost', lookup)).toBe('Add-on via a.ghost')
  })

  it('is just the availability without a source licence', () => {
    expect(availabilityText('add_on', null, lookup)).toBe('Add-on')
    expect(availabilityText('included', undefined, lookup)).toBe('Included')
  })
})

describe('AVAILABILITIES', () => {
  it('has no package feature entry', () => {
    expect(AVAILABILITIES).toEqual(['included', 'add_on'])
  })
})
