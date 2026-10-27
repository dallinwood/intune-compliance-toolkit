import { describe, expect, it } from 'vitest'
import { buildCatalogIndex, fullPlanId } from './catalogIndex'

type CatalogFile = Parameters<typeof buildCatalogIndex>[0][number]

function productFile(id: string, overrides: Record<string, unknown> = {}): CatalogFile {
  const slug = id.split('.')[1]
  return {
    kind: 'product',
    fileName: `products/a/${slug}.json`,
    value: { schema_version: 1, id, title: id, vendor: 'a', parent: null, category: null, description: null, links: [], targets: [], plans: [], ...overrides },
  }
}

function licenceFile(id: string, includes: unknown[], overrides: Record<string, unknown> = {}): CatalogFile {
  const slug = id.split('.')[1]
  return {
    kind: 'licence',
    fileName: `licences/a/${slug}.json`,
    value: { schema_version: 1, id, title: id, vendor: 'a', family: 'F', kind: 'subscription', requires: [], description: null, links: [], includes, review: [], ...overrides },
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
      licenceFile('a.lic', [{ product: 'a.thing', availability: 'add_on', note: 'n' }]),
    ])

    expect(index.by_product['a.thing']).toEqual([
      { licence: 'a.lic', availability: 'add_on', planId: null, customPlanTitle: null, via: 'direct', viaPlanId: null, note: 'n' },
    ])
  })

  it('records the full plan id and a custom plan title on a direct inclusion', () => {
    const { index } = build([
      productFile('a.thing', { plans: [{ id: 'plan_1', title: 'P1', description: null, features: [] }] }),
      productFile('a.mail'),
      licenceFile('a.lic', [
        { product: 'a.thing', plan: 'plan_1', availability: 'included', note: null },
        { product: 'a.mail', custom_plan: { title: 'Big', description: null }, availability: 'included', note: null },
      ]),
    ])

    expect(index.by_product['a.thing'][0].planId).toBe('a.thing.plan_1')
    expect(index.by_product['a.mail'][0].customPlanTitle).toBe('Big')
  })

  it('gives a plan feature an entry via the plan', () => {
    const { index } = build([
      productFile('a.thing', { plans: [{ id: 'plan_2', title: 'P2', description: null, features: ['a.x'] }] }),
      productFile('a.x', { parent: 'a.thing' }),
      licenceFile('a.lic', [{ product: 'a.thing', plan: 'plan_2', availability: 'included', note: null }]),
    ])

    expect(index.by_product['a.x']).toEqual([
      { licence: 'a.lic', availability: 'included', planId: null, customPlanTitle: null, via: 'plan', viaPlanId: 'a.thing.plan_2', note: null },
    ])
  })

  it('lists a feature included both ways once, as direct', () => {
    const { index } = build([
      productFile('a.thing', { plans: [{ id: 'plan_2', title: 'P2', description: null, features: ['a.x'] }] }),
      productFile('a.x', { parent: 'a.thing' }),
      licenceFile('a.lic', [
        { product: 'a.thing', plan: 'plan_2', availability: 'included', note: null },
        { product: 'a.x', availability: 'add_on', note: null },
      ]),
    ])

    expect(index.by_product['a.x']).toHaveLength(1)
    expect(index.by_product['a.x'][0].via).toBe('direct')
  })

  it('lists a feature reached through two plans once, under the first plan listed', () => {
    const { index } = build([
      productFile('a.one', { plans: [{ id: 'plan_1', title: 'P1', description: null, features: ['a.x'] }] }),
      productFile('a.two', { plans: [{ id: 'plan_1', title: 'P1', description: null, features: ['a.x'] }] }),
      productFile('a.x', { parent: 'a.one' }),
      licenceFile('a.lic', [
        { product: 'a.one', plan: 'plan_1', availability: 'included', note: null },
        { product: 'a.two', plan: 'plan_1', availability: 'add_on', note: null },
      ]),
    ])

    expect(index.by_product['a.x']).toHaveLength(1)
    expect(index.by_product['a.x'][0].viaPlanId).toBe('a.one.plan_1')
    expect(index.by_product['a.x'][0].availability).toBe('included')
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
    const { index } = build([licenceFile('a.lic', [], { review: ['check this'], requires: ['a.other'], family: 'Fam' })])

    expect(index.licences[0].review).toEqual(['check this'])
    expect(index.licences[0].requires).toEqual(['a.other'])
    expect(index.licences[0].family).toBe('Fam')
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
})
