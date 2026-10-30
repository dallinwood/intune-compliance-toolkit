import { describe, expect, it } from 'vitest'
import { buildCatalogIndex, parseCatalogIndex } from './catalogIndex'

type CatalogFile = Parameters<typeof buildCatalogIndex>[0][number]

function productFile(id: string, overrides: Record<string, unknown> = {}): CatalogFile {
  const slug = id.split('.')[1]
  return {
    kind: 'product',
    fileName: `products/a/${slug}.json`,
    value: { schema_version: 1, id, title: id, vendor: 'a', parent: null, requires: null, category: null, description: null, links: [], targets: [], ...overrides },
  }
}

function licenceFile(id: string, includes: unknown[], overrides: Record<string, unknown> = {}): CatalogFile {
  const slug = id.split('.')[1]
  return {
    kind: 'licence',
    fileName: `licences/a/${slug}.json`,
    value: { schema_version: 1, id, title: id, vendor: 'a', family: 'F', kind: 'subscription', requires: null, description: null, links: [], includes, review: [], ...overrides },
  }
}

function build(files: CatalogFile[]) {
  const warnings: string[] = []
  const index = buildCatalogIndex(files, (message) => warnings.push(message))
  return { index, warnings }
}

describe('buildCatalogIndex', () => {
  it('lists a direct inclusion with via direct', () => {
    const { index } = build([
      productFile('a.thing'),
      licenceFile('a.lic', [{ type: 'product', target: 'a.thing', availability: 'add_on', note: 'n' }]),
    ])

    expect(index.by_product['a.thing']).toEqual([
      { licence: 'a.lic', availability: 'add_on', via: 'direct', viaLicenceIds: [], note: 'n' },
    ])
  })

  it('rejects licences that use retired inclusion fields', () => {
    const { index, warnings } = build([
      productFile('a.thing'),
      licenceFile('a.old', [{ product: 'a.thing', availability: 'included', note: null }]),
      licenceFile('a.package', [{ type: 'product', target: 'a.thing', availability: 'included', package: 'a.thing', note: null }]),
      licenceFile('a.plan', [{ type: 'product', target: 'a.thing', availability: 'included', plan: 'plan_1', note: null }]),
      licenceFile('a.custom', [{ type: 'product', target: 'a.thing', availability: 'included', custom_plan: { title: 'Custom', description: null }, note: null }]),
    ])

    expect(index.licences).toEqual([])
    expect(warnings).toHaveLength(4)
  })

  it('expands nested licences with availability provenance and excludes nested optional add-ons', () => {
    const { index } = build([
      productFile('a.included'),
      productFile('a.optional'),
      productFile('a.addon-included'),
      licenceFile('a.inner', [
        { type: 'product', target: 'a.included', availability: 'included', note: 'inner note' },
        { type: 'product', target: 'a.optional', availability: 'add_on', note: null },
        { type: 'licence', target: 'a.inner-child', availability: 'included', note: null },
      ]),
      licenceFile('a.inner-child', [{ type: 'product', target: 'a.addon-included', availability: 'included', note: null }]),
      licenceFile('a.addon-suite', [{ type: 'product', target: 'a.included', availability: 'included', note: null }]),
      licenceFile('a.outer', [
        { type: 'licence', target: 'a.inner', availability: 'included', note: null },
        { type: 'licence', target: 'a.addon-suite', availability: 'add_on', note: null },
      ]),
    ])

    expect(index.by_product['a.included'].filter((entry) => entry.licence === 'a.outer').map((entry) => [entry.availability, entry.viaLicenceIds])).toEqual([
      ['add_on', ['a.addon-suite']],
      ['included', ['a.inner']],
    ])
    expect(index.by_product['a.addon-included'].find((entry) => entry.licence === 'a.outer')).toMatchObject({
      availability: 'included',
      viaLicenceIds: ['a.inner', 'a.inner-child'],
    })
    expect(index.by_product['a.optional'].some((entry) => entry.licence === 'a.outer')).toBe(false)
  })

  it('records a tier reached through a tier with the full licence path', () => {
    const { index } = build([
      productFile('a.identity'),
      productFile('a.reviews'),
      licenceFile('a.p1', [{ type: 'product', target: 'a.identity', availability: 'included', note: null }]),
      licenceFile('a.p2', [
        { type: 'licence', target: 'a.p1', availability: 'included', note: null },
        { type: 'product', target: 'a.reviews', availability: 'included', note: null },
      ]),
      licenceFile('a.e5', [{ type: 'licence', target: 'a.p2', availability: 'included', note: null }]),
    ])

    expect(index.by_product['a.identity']).toEqual([
      { licence: 'a.e5', availability: 'included', via: 'licence', viaLicenceIds: ['a.p2', 'a.p1'], note: null },
      { licence: 'a.p1', availability: 'included', via: 'direct', viaLicenceIds: [], note: null },
      { licence: 'a.p2', availability: 'included', via: 'licence', viaLicenceIds: ['a.p1'], note: null },
    ])
  })

  it('lists a product the licence names directly and through a nested licence once per route', () => {
    const { index } = build([
      productFile('a.x'),
      licenceFile('a.inner', [{ type: 'product', target: 'a.x', availability: 'included', note: null }]),
      licenceFile('a.lic', [
        { type: 'licence', target: 'a.inner', availability: 'included', note: null },
        { type: 'product', target: 'a.x', availability: 'add_on', note: null },
      ]),
    ])

    expect(index.by_product['a.x'].filter((entry) => entry.licence === 'a.lic').map((entry) => [entry.via, entry.availability])).toEqual([
      ['direct', 'add_on'],
      ['licence', 'included'],
    ])
  })

  it('keeps a licence whose every target is unknown, and warns about each', () => {
    const { index, warnings } = build([
      licenceFile('a.bad', [
        { type: 'product', target: 'a.missing', availability: 'included', note: null },
        { type: 'licence', target: 'a.ghost', availability: 'add_on', note: null },
      ]),
    ])

    expect(index.licences.map((entry) => entry.id)).toEqual(['a.bad'])
    expect(warnings).toHaveLength(2)
  })

  it('warns when inclusion targets do not resolve', () => {
    const { warnings } = build([
      licenceFile('a.bad', [
        { type: 'product', target: 'a.missing', availability: 'included', note: null },
        { type: 'licence', target: 'a.ghost', availability: 'add_on', note: null },
      ]),
    ])

    expect(warnings).toEqual([
      'a.bad: inclusion references unknown product a.missing.',
      'a.bad: inclusion references unknown licence a.ghost.',
    ])
  })

  it('keeps a product and a licence that share an id, but skips a duplicate within one kind', () => {
    const { index, warnings } = build([
      productFile('a.suite'),
      licenceFile('a.suite', []),
      { ...productFile('a.suite'), fileName: 'products/a/suite-copy.json' },
    ])

    expect(index.products.map((entry) => entry.id)).toEqual(['a.suite'])
    expect(index.licences.map((entry) => entry.id)).toEqual(['a.suite'])
    expect(warnings).toHaveLength(1)
  })

  it('skips a licence file without includes and warns', () => {
    const broken = licenceFile('a.lic', [])
    delete (broken.value as Record<string, unknown>).includes

    const { index, warnings } = build([productFile('a.thing'), broken])

    expect(index.licences).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('licences/a/lic.json')
  })

  it('passes review and other licence fields through unchanged', () => {
    const requires = { any_of: ['a.other', { all_of: ['a.one', 'a.two'] }] }
    const { index } = build([licenceFile('a.lic', [], { review: ['check this'], requires, family: 'Fam' })])

    expect(index.licences[0].review).toEqual(['check this'])
    expect(index.licences[0].requires).toEqual(requires)
    expect(index.licences[0].family).toBe('Fam')
  })

  it('passes a product requirement through unchanged', () => {
    const requires = { all_of: ['a.base', { any_of: ['a.plus-one', 'a.plus-two'] }] }
    const { index } = build([productFile('a.thing', { requires })])

    expect(index.products[0].requires).toEqual(requires)
  })

  it.each([
    ['a list', ['a.other']],
    ['a group of one', { all_of: ['a.other'] }],
    ['an unknown operator', { none_of: ['a.one', 'a.two'] }],
    ['two operators in one group', { all_of: ['a.one', 'a.two'], any_of: ['a.one', 'a.two'] }],
    ['an empty id', { any_of: ['a.one', ''] }],
  ])('skips a product whose requirement is %s', (_label, requires) => {
    const { index, warnings } = build([productFile('a.thing', { requires })])

    expect(index.products).toEqual([])
    expect(warnings).toHaveLength(1)
  })

  it('reads the vendors file', () => {
    const { index } = build([{ kind: 'vendors', fileName: 'vendors.json', value: { schema_version: 1, vendors: [{ id: 'a', title: 'A', url: null }] } }])

    expect(index.vendors).toEqual([{ id: 'a', title: 'A', url: null }])
  })

  it('is byte-stable and sorted by id whatever the input order', () => {
    const files = [productFile('a.zeta'), productFile('a.alpha'), licenceFile('a.l2', []), licenceFile('a.l1', [])]

    const first = build(files).index
    const second = build([...files].reverse()).index

    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(first.products.map((entry) => entry.id)).toEqual(['a.alpha', 'a.zeta'])
    expect(first.licences.map((entry) => entry.id)).toEqual(['a.l1', 'a.l2'])
  })
})

describe('parseCatalogIndex', () => {
  it('accepts version 3 index data and rejects version 2', () => {
    const index = build([productFile('a.product'), licenceFile('a.licence', [
      { type: 'product', target: 'a.product', availability: 'included', note: null },
    ])]).index

    expect(parseCatalogIndex(index)).toEqual(index)
    expect(parseCatalogIndex({ ...index, schema_version: 2 })).toBe('schema_version must be 3')
  })

  it('rejects malformed or legacy by_product entries', () => {
    const index = build([productFile('a.product'), licenceFile('a.licence', [])]).index
    const legacyEntry = { licence: 'a.licence', availability: 'included', via: 'plan', viaLicenceIds: [], note: null }

    expect(parseCatalogIndex({ ...index, by_product: { 'a.product': [{ licence: 'a.licence', product: 'a.product' }] } })).toBe(
      'by_product must contain lists of product licence entries',
    )
    expect(parseCatalogIndex({ ...index, by_product: { 'a.product': [legacyEntry] } })).toBe('by_product must contain lists of product licence entries')
  })
})
