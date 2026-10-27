import { describe, expect, it } from 'vitest'
import type { CatalogLicence, CatalogProduct } from '../types/catalog'
import { compareRows, isUniform } from './licenceCompare'

function product(id: string, overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return { id, title: id, vendor: 'a', parent: null, category: null, description: null, links: [], targets: [], plans: [], ...overrides }
}

function licence(id: string, includes: CatalogLicence['includes']): CatalogLicence {
  return { id, title: id, vendor: 'a', family: 'F', kind: 'subscription', requires: [], description: null, links: [], includes, review: [] }
}

const productsById = new Map(
  [
    product('a.root', { plans: [{ id: 'plan_1', title: 'Plan 1', description: null, features: [] }, { id: 'plan_2', title: 'Plan 2', description: null, features: [] }] }),
    product('a.child', { parent: 'a.root' }),
    product('a.other'),
  ].map((entry) => [entry.id, entry]),
)

describe('compareRows', () => {
  const left = licence('a.left', [
    { product: 'a.child', availability: 'included', note: null },
    { product: 'a.other', availability: 'included', note: null },
  ])
  const right = licence('a.right', [{ product: 'a.child', availability: 'add_on', note: null }])

  it('lists rows in tree order with ancestors as context rows and one cell per licence', () => {
    const rows = compareRows([left, right], productsById)

    expect(rows.map((row) => [row.product.id, row.depth])).toEqual([
      ['a.other', 0],
      ['a.root', 0],
      ['a.child', 1],
    ])
    expect(rows[0].cells.map((cell) => cell?.availability ?? null)).toEqual(['included', null])
    expect(rows[1].cells).toEqual([null, null])
    expect(rows[2].cells.map((cell) => cell?.availability)).toEqual(['included', 'add_on'])
  })

  it('returns no rows for no licences', () => {
    expect(compareRows([], productsById)).toEqual([])
  })
})

describe('isUniform', () => {
  const rowFor = (cells: CatalogLicence['includes']) => {
    const rows = compareRows(
      cells.map((inclusion, position) => licence(`a.l${position}`, [inclusion])),
      productsById,
    )
    return rows.find((row) => row.product.id === 'a.root')!
  }

  it('is true when every cell has the same availability and plan', () => {
    const included = { product: 'a.root', plan: 'plan_1', availability: 'included' as const, note: null }
    expect(isUniform(rowFor([included, { ...included, note: 'different note' }]))).toBe(true)
  })

  it('is false when availability or plan differs', () => {
    const included = { product: 'a.root', plan: 'plan_1', availability: 'included' as const, note: null }
    expect(isUniform(rowFor([included, { ...included, availability: 'add_on' }]))).toBe(false)
    expect(isUniform(rowFor([included, { ...included, plan: 'plan_2' }]))).toBe(false)
  })

  it('is false when only some licences have the product', () => {
    const rows = compareRows([licence('a.l0', [{ product: 'a.other', availability: 'included', note: null }]), licence('a.l1', [])], productsById)
    expect(isUniform(rows[0])).toBe(false)
  })
})
