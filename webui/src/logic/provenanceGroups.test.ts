import { describe, expect, it } from 'vitest'
import { groupByProvenance } from './provenanceGroups'

const entry = (name: string, provenance: 'official' | 'community') => ({ name, provenance })

describe('groupByProvenance', () => {
  it('splits official from community, each keeping its current order', () => {
    const groups = groupByProvenance([
      entry('cis_rhel9', 'community'),
      entry('mscp', 'official'),
      entry('cis_ubuntu2404', 'community'),
      entry('asd_ism', 'official'),
    ])

    expect(groups.official.map((source) => source.name)).toEqual(['mscp', 'asd_ism'])
    expect(groups.community.map((source) => source.name)).toEqual(['cis_rhel9', 'cis_ubuntu2404'])
  })

  it('keeps a source whose provenance is missing or unknown, in the community group', () => {
    const missing = { name: 'no_provenance' } as unknown as ReturnType<typeof entry>
    const unknown = { name: 'odd', provenance: 'vendor' } as unknown as ReturnType<typeof entry>
    const groups = groupByProvenance([entry('mscp', 'official'), missing, unknown, entry('cis_rhel9', 'community')])

    expect(groups.official.map((source) => source.name)).toEqual(['mscp'])
    expect(groups.community.map((source) => source.name)).toEqual(['no_provenance', 'odd', 'cis_rhel9'])
  })

  it('returns empty groups when a kind is absent', () => {
    expect(groupByProvenance([entry('mscp', 'official')])).toEqual({ official: [entry('mscp', 'official')], community: [] })
    expect(groupByProvenance([])).toEqual({ official: [], community: [] })
  })
})
