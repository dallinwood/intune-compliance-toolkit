import { describe, expect, it } from 'vitest'
import type { RuleRow } from '../types/rule-row'
import { allFacetValues, facetOptions, matchesFilters, type FilterValues } from './ruleFilters'

function row(overrides: Partial<RuleRow> = {}): RuleRow {
  return {
    ref: { id: 'mscp.os_gatekeeper_enable', path: 'mscp/rules/os_gatekeeper_enable.json' },
    title: 'Enable Gatekeeper',
    section: 'os',
    sourceName: 'mscp',
    releaseTag: 'release_27.0',
    assessment: { status: 'automated', manual_reason: null },
    architecture: null,
    applicability: { '26.0': [{ name: 'cis_lvl1', severity: null }] },
    osVersions: ['26.0'],
    benchmarks: ['cis_lvl1'],
    tags: ['800-53r5_high'],
    hasOdv: false,
    ...overrides,
  }
}

function emptyFilters(overrides: Partial<FilterValues> = {}): FilterValues {
  return {
    search: '',
    osVersions: new Set(),
    benchmarks: new Set(),
    sections: new Set(),
    tags: new Set(),
    automatable: 'all',
    ...overrides,
  }
}

const gatekeeperRow = row()
const passwordRow = row({
  ref: { id: 'mscp.pwpolicy_minimum_length_enforce', path: 'mscp/rules/pwpolicy_minimum_length_enforce.json' },
  title: 'Require a Minimum Password Length of $ODV Characters',
  section: 'pwpolicy',
  assessment: { status: 'manual', manual_reason: 'manual' },
  applicability: {
    '27.0': [{ name: 'disa_stig', severity: 'medium' }],
    '26.0': [{ name: 'disa_stig', severity: 'medium' }, { name: 'cis_lvl2', severity: null }],
  },
  osVersions: ['27.0', '26.0'],
  benchmarks: ['cis_lvl2', 'disa_stig'],
  tags: ['cisv8'],
  hasOdv: true,
})
const rows = [gatekeeperRow, passwordRow]

describe('matchesFilters', () => {
  it('matches everything when no filters are set', () => {
    expect(matchesFilters(gatekeeperRow, emptyFilters())).toBe(true)
    expect(matchesFilters(passwordRow, emptyFilters())).toBe(true)
  })

  it('filters by OS version when the row lists at least one selected version', () => {
    const filters = emptyFilters({ osVersions: new Set(['27.0']) })
    expect(matchesFilters(gatekeeperRow, filters)).toBe(false)
    expect(matchesFilters(passwordRow, filters)).toBe(true)
  })

  it('filters by section', () => {
    const filters = emptyFilters({ sections: new Set(['pwpolicy']) })
    expect(matchesFilters(gatekeeperRow, filters)).toBe(false)
    expect(matchesFilters(passwordRow, filters)).toBe(true)
  })

  it('filters by tag using any match', () => {
    const filters = emptyFilters({ tags: new Set(['cisv8', 'unrelated']) })
    expect(matchesFilters(gatekeeperRow, filters)).toBe(false)
    expect(matchesFilters(passwordRow, filters)).toBe(true)
  })

  it('filters by assessment status', () => {
    expect(matchesFilters(gatekeeperRow, emptyFilters({ automatable: 'automatable' }))).toBe(true)
    expect(matchesFilters(passwordRow, emptyFilters({ automatable: 'automatable' }))).toBe(false)
    expect(matchesFilters(gatekeeperRow, emptyFilters({ automatable: 'manual' }))).toBe(false)
    expect(matchesFilters(passwordRow, emptyFilters({ automatable: 'manual' }))).toBe(true)
  })

  it('matches a benchmark on any version when no versions are selected', () => {
    const filters = emptyFilters({ benchmarks: new Set(['cis_lvl1']) })
    expect(matchesFilters(gatekeeperRow, filters)).toBe(true)
    expect(matchesFilters(passwordRow, filters)).toBe(false)
  })

  it('scopes a benchmark to the selected versions', () => {
    const cisLevelOneOnTwentySixOnly = row({
      applicability: {
        '27.0': [{ name: 'disa_stig', severity: null }],
        '26.0': [{ name: 'cis_lvl1', severity: null }],
      },
      osVersions: ['27.0', '26.0'],
      benchmarks: ['cis_lvl1', 'disa_stig'],
    })

    const onTwentySeven = emptyFilters({ osVersions: new Set(['27.0']), benchmarks: new Set(['cis_lvl1']) })
    const onTwentySix = emptyFilters({ osVersions: new Set(['26.0']), benchmarks: new Set(['cis_lvl1']) })

    expect(matchesFilters(cisLevelOneOnTwentySixOnly, onTwentySeven)).toBe(false)
    expect(matchesFilters(cisLevelOneOnTwentySixOnly, onTwentySix)).toBe(true)
  })

  it('does not scope the benchmark match by versions when osVersions is the excluded dimension', () => {
    const filters = emptyFilters({ osVersions: new Set(['27.0']), benchmarks: new Set(['cis_lvl2']) })
    expect(matchesFilters(passwordRow, filters)).toBe(false)
    expect(matchesFilters(passwordRow, filters, 'osVersions')).toBe(true)
  })

  it('searches the title case-insensitively', () => {
    expect(matchesFilters(passwordRow, emptyFilters({ search: 'MINIMUM PASSWORD' }))).toBe(true)
    expect(matchesFilters(gatekeeperRow, emptyFilters({ search: 'MINIMUM PASSWORD' }))).toBe(false)
  })

  it('searches by upstream id without the mscp. prefix', () => {
    expect(matchesFilters(passwordRow, emptyFilters({ search: 'pwpolicy_minimum' }))).toBe(true)
    expect(matchesFilters(passwordRow, emptyFilters({ search: 'PWPOLICY_MINIMUM' }))).toBe(true)
    expect(matchesFilters(gatekeeperRow, emptyFilters({ search: 'pwpolicy_minimum' }))).toBe(false)
  })

  it('does not match the mscp. prefix itself', () => {
    expect(matchesFilters(passwordRow, emptyFilters({ search: 'mscp.' }))).toBe(false)
  })

  it('ignores the excluded dimension', () => {
    const filters = emptyFilters({ sections: new Set(['pwpolicy']) })
    expect(matchesFilters(gatekeeperRow, filters, 'sections')).toBe(true)
  })
})

describe('facetOptions', () => {
  it('offers every value present when nothing else is selected', () => {
    const options = facetOptions(rows, emptyFilters(), 'sections', (r) => r.section, [])
    expect(options).toEqual(['os', 'pwpolicy'])
  })

  it('narrows to only the values reachable under the other applied filters', () => {
    const filters = emptyFilters({ sections: new Set(['pwpolicy']) })
    const options = facetOptions(rows, filters, 'osVersions', (r) => r.osVersions, filters.osVersions)
    expect(options).toEqual(['26.0', '27.0'])

    const narrower = emptyFilters({ osVersions: new Set(['27.0']) })
    expect(facetOptions(rows, narrower, 'sections', (r) => r.section, narrower.sections)).toEqual(['pwpolicy'])
  })

  it('does not narrow a facet by its own selection', () => {
    const filters = emptyFilters({ sections: new Set(['pwpolicy']) })
    const options = facetOptions(rows, filters, 'sections', (r) => r.section, filters.sections)
    expect(options).toEqual(['os', 'pwpolicy'])
  })

  it('keeps an already-selected value visible even once it becomes unreachable', () => {
    const filters = emptyFilters({ sections: new Set(['pwpolicy']), osVersions: new Set(['9.9']) })
    const options = facetOptions(rows, filters, 'osVersions', (r) => r.osVersions, filters.osVersions)
    expect(options).toEqual(['26.0', '27.0', '9.9'])
  })

  it('flattens array-valued facets like benchmarks', () => {
    const options = facetOptions(rows, emptyFilters(), 'benchmarks', (r) => r.benchmarks, [])
    expect(options).toEqual(['cis_lvl1', 'cis_lvl2', 'disa_stig'])
  })
})

describe('allFacetValues', () => {
  it('lists every distinct value regardless of any filter', () => {
    expect(allFacetValues(rows, (r) => r.section)).toEqual(['os', 'pwpolicy'])
  })

  it('flattens array-valued facets', () => {
    expect(allFacetValues(rows, (r) => r.benchmarks)).toEqual(['cis_lvl1', 'cis_lvl2', 'disa_stig'])
  })
})
