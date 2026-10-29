import { describe, expect, it } from 'vitest'
import { buildCatalogIndex, fullPlanId, parseCatalogIndex } from './catalogIndex'

type CatalogFile = Parameters<typeof buildCatalogIndex>[0][number]

function productFile(id: string, overrides: Record<string, unknown> = {}): CatalogFile {
  const slug = id.split('.')[1]
  return {
    kind: 'product',
    fileName: `products/a/${slug}.json`,
    value: { schema_version: 1, id, title: id, vendor: 'a', parent: null, requires: null, category: null, description: null, links: [], targets: [], plans: [], ...overrides },
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
      { licence: 'a.lic', availability: 'add_on', planId: null, customPlanTitle: null, via: 'direct', viaPlanId: null, viaLicenceIds: [], viaProductId: null, note: 'n' },
    ])
  })

  it('derives plan provenance for add-ons without storing package fields', () => {
    const { index, warnings } = build([
      productFile('a.suite'),
      productFile('a.thing', { parent: 'a.suite', plans: [{ id: 'plan_1', title: 'P1', description: null, features: ['a.x'] }] }),
      productFile('a.x', { parent: 'a.thing' }),
      licenceFile('a.lic', [
        { type: 'product', target: 'a.suite', availability: 'add_on', note: null },
        { type: 'product', target: 'a.thing', plan: 'plan_1', availability: 'add_on', note: null },
      ]),
    ])

    expect(warnings).toEqual([])
    expect(index.by_product['a.thing'][0].viaProductId).toBeNull()
    expect(index.by_product['a.x'][0].viaProductId).toBe('a.thing')
    expect(index.by_product['a.suite'][0].viaProductId).toBeNull()
  })

  it('rejects legacy product/package fields and conflicting plans', () => {
    const { index, warnings } = build([
      productFile('a.thing'),
      licenceFile('a.old', [{ product: 'a.thing', availability: 'included', note: null }]),
      licenceFile('a.bad', [{ type: 'product', target: 'a.thing', availability: 'add_on', plan: 'p1', custom_plan: { title: 'Custom', description: null }, note: null }]),
      licenceFile('a.package', [{ type: 'product', target: 'a.thing', availability: 'included', package: 'a.thing', note: null }]),
      licenceFile('a.licence-plan', [{ type: 'licence', target: 'a.target', availability: 'included', plan: 'p1', note: null }]),
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
      ['included', ['a.inner']],
      ['add_on', ['a.addon-suite']],
    ])
    expect(index.by_product['a.addon-included'].find((entry) => entry.licence === 'a.outer')).toMatchObject({
      availability: 'included',
      viaLicenceIds: ['a.inner', 'a.inner-child'],
    })
    expect(index.by_product['a.optional'].some((entry) => entry.licence === 'a.outer')).toBe(false)
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

  it('records the full plan id and a custom plan title on a direct inclusion', () => {
    const { index } = build([
      productFile('a.thing', { plans: [{ id: 'plan_1', title: 'P1', description: null, features: [] }] }),
      productFile('a.mail'),
      licenceFile('a.lic', [
        { type: 'product', target: 'a.thing', plan: 'plan_1', availability: 'included', note: null },
        { type: 'product', target: 'a.mail', custom_plan: { title: 'Big', description: null }, availability: 'included', note: null },
      ]),
    ])

    expect(index.by_product['a.thing'][0].planId).toBe('a.thing.plan_1')
    expect(index.by_product['a.mail'][0].customPlanTitle).toBe('Big')
  })

  it('gives a plan feature an entry via the plan', () => {
    const { index } = build([
      productFile('a.thing', { plans: [{ id: 'plan_2', title: 'P2', description: null, features: ['a.x'] }] }),
      productFile('a.x', { parent: 'a.thing' }),
      licenceFile('a.lic', [{ type: 'product', target: 'a.thing', plan: 'plan_2', availability: 'included', note: null }]),
    ])

    expect(index.by_product['a.x']).toEqual([
      { licence: 'a.lic', availability: 'included', planId: null, customPlanTitle: null, via: 'plan', viaPlanId: 'a.thing.plan_2', viaLicenceIds: [], viaProductId: 'a.thing', note: null },
    ])
  })

  it('lists a feature included both ways once, as direct', () => {
    const { index } = build([
      productFile('a.thing', { plans: [{ id: 'plan_2', title: 'P2', description: null, features: ['a.x'] }] }),
      productFile('a.x', { parent: 'a.thing' }),
      licenceFile('a.lic', [
        { type: 'product', target: 'a.thing', plan: 'plan_2', availability: 'included', note: null },
        { type: 'product', target: 'a.x', availability: 'add_on', note: null },
      ]),
    ])

    expect(index.by_product['a.x']).toHaveLength(1)
    expect(index.by_product['a.x'][0].via).toBe('direct')
  })

  it('preserves independent plan routes to the same feature', () => {
    const { index } = build([
      productFile('a.one', { plans: [{ id: 'plan_1', title: 'P1', description: null, features: ['a.x'] }] }),
      productFile('a.two', { plans: [{ id: 'plan_1', title: 'P1', description: null, features: ['a.x'] }] }),
      productFile('a.x', { parent: 'a.one' }),
      licenceFile('a.lic', [
        { type: 'product', target: 'a.one', plan: 'plan_1', availability: 'included', note: null },
        { type: 'product', target: 'a.two', plan: 'plan_1', availability: 'add_on', note: null },
      ]),
    ])

    expect(index.by_product['a.x']).toHaveLength(2)
    expect(index.by_product['a.x'].map((entry) => [entry.viaPlanId, entry.availability])).toEqual([
      ['a.one.plan_1', 'included'],
      ['a.two.plan_1', 'add_on'],
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
    const requires = { all_of: ['a.base', { any_of: ['a.plus.plan_1', 'a.plus.plan_2'] }] }
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

describe('fullPlanId', () => {
  it('joins the product id and plan id with a dot', () => {
    expect(fullPlanId('a.thing', 'plan_1')).toBe('a.thing.plan_1')
  })

  describe('parseCatalogIndex', () => {
    it('accepts version 2 index data and rejects version 1', () => {
      const index = build([productFile('a.product'), licenceFile('a.licence', [
        { type: 'product', target: 'a.product', availability: 'included', note: null },
      ])]).index

      expect(parseCatalogIndex(index)).toEqual(index)
      expect(parseCatalogIndex({ ...index, schema_version: 1 })).toBe('schema_version must be 2')
    })

    it('rejects malformed or legacy by_product entries', () => {
      const index = build([productFile('a.product'), licenceFile('a.licence', [])]).index

      expect(parseCatalogIndex({ ...index, by_product: { 'a.product': [{ licence: 'a.licence', product: 'a.product' }] } })).toBe(
        'by_product must contain lists of product licence entries',
      )
    })
  })
})
