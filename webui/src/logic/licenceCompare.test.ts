import { describe, expect, it } from 'vitest'
import type { CatalogLicence, CatalogProduct } from '../types/catalog'
import { compareRows, isUniform, withoutIdenticalRows } from './licenceCompare'

function product(id: string, overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return { id, title: id, vendor: 'a', parent: null, requires: null, category: null, description: null, links: [], targets: [], ...overrides }
}

function licence(id: string, includes: CatalogLicence['includes']): CatalogLicence {
  return { id, title: id, vendor: 'a', family: 'F', kind: 'subscription', requires: null, description: null, links: [], includes, review: [] }
}

function includesProduct(target: string, availability: 'included' | 'add_on' = 'included', note: string | null = null) {
  return { type: 'product' as const, target, availability, note }
}

function includesLicence(target: string, availability: 'included' | 'add_on' = 'included') {
  return { type: 'licence' as const, target, availability, note: null }
}

const productsById = new Map(
  [product('a.root'), product('a.child', { parent: 'a.root' }), product('a.other')].map((entry) => [entry.id, entry]),
)

// Entra-style tiers: P2 contains P1, and the two suites each contain one tier.
const tierOne = licence('a.p1', [includesProduct('a.root')])
const tierTwo = licence('a.p2', [includesLicence('a.p1'), includesProduct('a.other')])
const offeredTier = licence('a.offered', [includesProduct('a.root')])
const suiteWithTierOne = licence('a.e3', [includesLicence('a.p1')])
const suiteWithTierTwo = licence('a.e5', [includesLicence('a.p2')])
const allLicences = [tierOne, tierTwo, offeredTier, suiteWithTierOne, suiteWithTierTwo]

function rootRowOf(licences: CatalogLicence[]) {
  return compareRows(licences, productsById, [...allLicences, ...licences]).find((row) => row.product.id === 'a.root')!
}

describe('compareRows', () => {
  const left = licence('a.left', [includesProduct('a.child'), includesProduct('a.other')])
  const right = licence('a.right', [includesProduct('a.child', 'add_on')])

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

  it('fills a cell from a nested tier and keeps the licence path', () => {
    const row = rootRowOf([suiteWithTierOne, suiteWithTierTwo])

    expect(row.cells.map((cell) => cell?.viaLicenceIds)).toEqual([['a.p1'], ['a.p2', 'a.p1']])
  })

  it('prefers an included route over an add-on one, then a direct entry over a nested one', () => {
    const addOnFirst = licence('a.add-on-first', [includesProduct('a.root', 'add_on'), includesLicence('a.p1')])
    const directAndNested = licence('a.both', [includesLicence('a.p1'), includesProduct('a.root')])
    const offeredOnly = licence('a.offered-only', [includesLicence('a.offered', 'add_on'), includesLicence('a.p1')])

    const row = rootRowOf([addOnFirst, directAndNested, offeredOnly])

    expect(row.cells.map((cell) => [cell?.availability, cell?.via])).toEqual([
      ['included', 'licence'],
      ['included', 'direct'],
      ['included', 'licence'],
    ])
  })

  it('returns no rows for no licences', () => {
    expect(compareRows([], productsById)).toEqual([])
  })
})

describe('isUniform', () => {
  it('is true when every cell has the same availability and source, whatever the notes', () => {
    const noted = licence('a.noted', [includesProduct('a.root', 'included', 'different note')])
    const plain = licence('a.plain', [includesProduct('a.root')])

    expect(isUniform(rootRowOf([plain, noted]))).toBe(true)
  })

  it('is false when availability differs', () => {
    const addOn = licence('a.add-on', [includesProduct('a.root', 'add_on')])
    const included = licence('a.included', [includesProduct('a.root')])

    expect(isUniform(rootRowOf([included, addOn]))).toBe(false)
  })

  it('is false when the cells differ only by the tier that supplies the product', () => {
    expect(isUniform(rootRowOf([suiteWithTierOne, suiteWithTierTwo]))).toBe(false)
  })

  it('is false when one cell is direct and the other comes through a nested licence', () => {
    expect(isUniform(rootRowOf([tierOne, suiteWithTierOne]))).toBe(false)
  })

  it('is true when the supplying licence matches even though deeper paths differ', () => {
    const cellThrough = (viaLicenceIds: string[]) => ({ ...includesProduct('a.root'), via: 'licence' as const, viaLicenceIds })
    const row = { product: product('a.root'), depth: 0, cells: [cellThrough(['a.wrapper', 'a.p1']), cellThrough(['a.wrapper', 'a.p1-again'])] }

    expect(isUniform(row)).toBe(true)
  })

  it('is false when only some licences have the product', () => {
    const rows = compareRows([licence('a.l0', [includesProduct('a.other')]), licence('a.l1', [])], productsById)

    expect(isUniform(rows[0])).toBe(false)
  })
})

describe('withoutIdenticalRows', () => {
  it('keeps a uniform ancestor while one of its descendants differs, and drops uniform rows elsewhere', () => {
    const rows = compareRows(
      [
        licence('a.l0', [includesProduct('a.root'), includesProduct('a.child'), includesProduct('a.other')]),
        licence('a.l1', [includesProduct('a.root'), includesProduct('a.child', 'add_on'), includesProduct('a.other')]),
      ],
      productsById,
    )

    expect(withoutIdenticalRows(rows).map((row) => row.product.id)).toEqual(['a.root', 'a.child'])
  })

  it('keeps a row whose cells differ only by supplying tier', () => {
    const rows = compareRows([suiteWithTierOne, suiteWithTierTwo], productsById, allLicences)

    expect(withoutIdenticalRows(rows).map((row) => row.product.id)).toEqual(['a.other', 'a.root'])
  })

  it('keeps a context-only ancestor of a differing row', () => {
    const rows = compareRows([licence('a.l0', [includesProduct('a.child')]), licence('a.l1', [])], productsById)

    expect(withoutIdenticalRows(rows).map((row) => row.product.id)).toEqual(['a.root', 'a.child'])
  })
})
