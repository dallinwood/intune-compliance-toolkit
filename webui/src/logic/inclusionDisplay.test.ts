import { describe, expect, it } from 'vitest'
import type { CatalogIndex, CatalogProduct } from '../types/catalog'
import { AVAILABILITIES } from './catalogIndex'
import { availabilityText, buildCatalogLookup, requiredProductLabelOf } from './inclusionDisplay'

function product(id: string, title: string): CatalogProduct {
  return { id, title, vendor: 'a', parent: null, requires: null, category: null, description: null, links: [], targets: [], plans: [] }
}

const lookup = buildCatalogLookup({
  schema_version: 2,
  vendors: [],
  products: [product('a.suite', 'Teams Premium'), { ...product('a.id', 'Entra ID'), plans: [{ id: 'plan_1', title: 'P1', description: null, features: [] }] }],
  licences: [],
  by_product: {},
} satisfies CatalogIndex)

describe('requiredProductLabelOf', () => {
  it('names a product', () => {
    expect(requiredProductLabelOf('a.suite', lookup)).toEqual({ productId: 'a.suite', title: 'Teams Premium' })
  })

  it('names a plan after its product and links to the product', () => {
    expect(requiredProductLabelOf('a.id.plan_1', lookup)).toEqual({ productId: 'a.id', title: 'Entra ID P1' })
  })

  it('falls back to the id for an unknown product or plan', () => {
    expect(requiredProductLabelOf('a.ghost', lookup)).toEqual({ productId: null, title: 'a.ghost' })
    expect(requiredProductLabelOf('a.id.plan_9', lookup)).toEqual({ productId: 'a.id', title: 'a.id.plan_9' })
  })
})

describe('availabilityText', () => {
  it('names the package an add-on comes from', () => {
    expect(availabilityText('add_on', 'a.suite', lookup)).toBe('Add-on via Teams Premium')
  })

  it('falls back to the package id when the catalog does not have the product', () => {
    expect(availabilityText('add_on', 'a.ghost', lookup)).toBe('Add-on via a.ghost')
  })

  it('is just the availability without a package', () => {
    expect(availabilityText('add_on', null, lookup)).toBe('Add-on')
    expect(availabilityText('included', undefined, lookup)).toBe('Included')
  })
})

describe('AVAILABILITIES', () => {
  it('has no package feature entry', () => {
    expect(AVAILABILITIES).toEqual(['included', 'add_on'])
  })
})
