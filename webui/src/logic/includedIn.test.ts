import { describe, expect, it } from 'vitest'
import type { ProductLicenceEntry } from '../types/catalog'
import { groupLicenceEntries } from './includedIn'

function entry(licence: string, overrides: Partial<ProductLicenceEntry> = {}): ProductLicenceEntry {
  return { licence, availability: 'included', via: 'direct', viaLicenceIds: [], note: null, ...overrides }
}

describe('groupLicenceEntries', () => {
  it('merges the routes of one licence into one row, ordered by licence', () => {
    const rows = groupLicenceEntries([
      entry('b.e5', { via: 'licence', viaLicenceIds: ['b.p2', 'b.p1'] }),
      entry('a.e3', { via: 'licence', viaLicenceIds: ['b.p1'] }),
      entry('b.e5', { via: 'licence', viaLicenceIds: ['b.suite'], note: 'Needs setup' }),
    ])

    expect(rows.map((row) => row.licence)).toEqual(['a.e3', 'b.e5'])
    expect(rows[1].supplyingLicenceIds).toEqual(['b.p2', 'b.suite'])
    expect(rows[1].notes).toEqual(['Needs setup'])
  })

  it('names only the first nested licence of each route, once', () => {
    const rows = groupLicenceEntries([
      entry('a.x', { via: 'licence', viaLicenceIds: ['a.p2', 'a.p1'] }),
      entry('a.x', { via: 'licence', viaLicenceIds: ['a.p2', 'a.other'] }),
    ])

    expect(rows[0].supplyingLicenceIds).toEqual(['a.p2'])
  })

  it('has no supplying licence for a direct entry and drops duplicate notes', () => {
    const rows = groupLicenceEntries([entry('a.x', { note: 'n' }), entry('a.x', { note: 'n' })])

    expect(rows).toEqual([{ licence: 'a.x', supplyingLicenceIds: [], notes: ['n'] }])
  })
})
