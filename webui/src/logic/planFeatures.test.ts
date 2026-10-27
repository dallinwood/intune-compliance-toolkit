import { describe, expect, it } from 'vitest'
import type { CatalogPlan } from '../types/catalog'
import type { ProductLicenceEntry } from '../types/catalog'
import { groupLicenceEntries, planFeatureLists } from './planFeatures'

function plan(id: string, features: string[]): CatalogPlan {
  return { id, title: id, description: null, features }
}

describe('planFeatureLists', () => {
  it('shows only the additions when the previous plan is a subset', () => {
    const lists = planFeatureLists([plan('p1', ['a', 'b']), plan('p2', ['a', 'b', 'c'])])

    expect(lists[0]).toEqual({ plan: expect.objectContaining({ id: 'p1' }), basedOnPlanTitle: null, featureIds: ['a', 'b'] })
    expect(lists[1]).toEqual({ plan: expect.objectContaining({ id: 'p2' }), basedOnPlanTitle: 'p1', featureIds: ['c'] })
  })

  it('lists everything when the previous plan is not a subset', () => {
    const lists = planFeatureLists([plan('p1', ['a', 'x']), plan('p2', ['a', 'b'])])

    expect(lists[1].basedOnPlanTitle).toBeNull()
    expect(lists[1].featureIds).toEqual(['a', 'b'])
  })

  it('does not treat an empty previous plan as a base', () => {
    const lists = planFeatureLists([plan('p1', []), plan('p2', ['a'])])

    expect(lists[1].basedOnPlanTitle).toBeNull()
    expect(lists[1].featureIds).toEqual(['a'])
  })

  it('shows no additions for a plan identical to the previous one', () => {
    const lists = planFeatureLists([plan('p1', ['a']), plan('p2', ['a'])])

    expect(lists[1]).toMatchObject({ basedOnPlanTitle: 'p1', featureIds: [] })
  })
})

describe('groupLicenceEntries', () => {
  function entry(licence: string, overrides: Partial<ProductLicenceEntry> = {}): ProductLicenceEntry {
    return { licence, availability: 'included', package: null, planId: null, customPlanTitle: null, via: 'direct', viaPlanId: null, note: null, ...overrides }
  }

  it('merges a licence listed under several plans into one row with every plan, ordered by licence', () => {
    const rows = groupLicenceEntries([
      entry('b.e5', { planId: 'p.plan_2' }),
      entry('a.e3'),
      entry('b.e5', { planId: 'p.plan_2_step_up', note: 'Needs setup' }),
      entry('b.e5', { via: 'plan', viaPlanId: 'p.plan_2' }),
    ])

    expect(rows.map((row) => row.licence)).toEqual(['a.e3', 'b.e5'])
    expect(rows[1].planIds).toEqual(['p.plan_2', 'p.plan_2_step_up'])
    expect(rows[1].viaPlanIds).toEqual(['p.plan_2'])
    expect(rows[1].notes).toEqual(['Needs setup'])
  })

  it('collects the packages a licence gets the product through, once each', () => {
    const rows = groupLicenceEntries([
      entry('a.x', { availability: 'add_on', package: 'a.suite' }),
      entry('a.x', { availability: 'add_on', package: 'a.suite', via: 'plan', viaPlanId: 'p.plan_1' }),
      entry('a.y'),
    ])

    expect(rows.map((row) => row.packageIds)).toEqual([['a.suite'], []])
  })

  it('collects custom plan titles and drops duplicate notes', () => {
    const rows = groupLicenceEntries([entry('a.x', { customPlanTitle: 'Lite', note: 'n' }), entry('a.x', { customPlanTitle: 'Lite', note: 'n' })])

    expect(rows).toHaveLength(1)
    expect(rows[0].customPlanTitles).toEqual(['Lite'])
    expect(rows[0].notes).toEqual(['n'])
  })
})
