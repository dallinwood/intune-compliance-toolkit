import { describe, expect, it } from 'vitest'
import type { CatalogIndex, CatalogProduct } from '../types/catalog'
import { AVAILABILITIES } from './catalogIndex'
import { availabilityText, buildCatalogLookup } from './inclusionDisplay'

function product(id: string, title: string): CatalogProduct {
  return { id, title, vendor: 'a', parent: null, category: null, description: null, links: [], targets: [], plans: [] }
}

const lookup = buildCatalogLookup({
  schema_version: 1,
  vendors: [],
  products: [product('a.suite', 'Teams Premium')],
  licences: [],
  by_product: {},
} satisfies CatalogIndex)

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
