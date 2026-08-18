import { describe, expect, it } from 'vitest'
import type { RuleRow } from '../types/rule-row'
import { allFacetValues, facetOptions, matchesFilters, type FilterValues } from './ruleFilters'

function row(overrides: Partial<RuleRow> = {}): RuleRow {
  return {
    ref: { family: 'cis', product: 'macos_26_tahoe', version: 'v1.1.0', file: 'rule.json', id: '1.1' },
    title: 'Example rule',
    assessmentStatus: 'Automated',
    sourceAssessmentStatus: 'Automated',
    platform: 'macOS',
    profileApplicability: ['Level 1'],
    requiresOrganizationDefinedValue: false,
    ...overrides,
  }
}

function emptyFilters(overrides: Partial<FilterValues> = {}): FilterValues {
  return {
    search: '',
    products: new Set(),
    versions: new Set(),
    platforms: new Set(),
    profiles: new Set(),
    automatable: 'all',
    ...overrides,
  }
}

const macosRow = row()
const windowsRow = row({
  ref: { family: 'cis', product: 'windows_11', version: 'v5.0.0', file: 'win.json', id: '2.1' },
  platform: 'Windows',
  profileApplicability: ['Level 2'],
  assessmentStatus: 'Manual',
  sourceAssessmentStatus: 'Manual',
})
const rows = [macosRow, windowsRow]

describe('matchesFilters', () => {
  it('matches everything when no filters are set', () => {
    expect(matchesFilters(macosRow, emptyFilters())).toBe(true)
    expect(matchesFilters(windowsRow, emptyFilters())).toBe(true)
  })

  it('filters by product', () => {
    const filters = emptyFilters({ products: new Set(['windows_11']) })
    expect(matchesFilters(macosRow, filters)).toBe(false)
    expect(matchesFilters(windowsRow, filters)).toBe(true)
  })

  it('ignores the excluded dimension', () => {
    const filters = emptyFilters({ products: new Set(['windows_11']) })
    expect(matchesFilters(macosRow, filters, 'products')).toBe(true)
  })
})

describe('facetOptions', () => {
  it('offers every value present when nothing else is selected', () => {
    const options = facetOptions(rows, emptyFilters(), 'versions', (r) => r.ref.version, [])
    expect(options).toEqual(['v1.1.0', 'v5.0.0'])
  })

  it('narrows to only the values reachable under the other applied filters', () => {
    const filters = emptyFilters({ products: new Set(['windows_11']) })
    const options = facetOptions(rows, filters, 'versions', (r) => r.ref.version, filters.versions)
    expect(options).toEqual(['v5.0.0'])
  })

  it('does not narrow a facet by its own selection', () => {
    const filters = emptyFilters({ products: new Set(['windows_11', 'macos_26_tahoe']) })
    const options = facetOptions(rows, filters, 'products', (r) => r.ref.product, filters.products)
    expect(options).toEqual(['macos_26_tahoe', 'windows_11'])
  })

  it('keeps an already-selected value visible even once it becomes unreachable', () => {
    // A previously-selected version that no row in the whole dataset has -
    // e.g. left over from an import - must not silently disappear with no
    // way left to uncheck it.
    const filters = emptyFilters({ products: new Set(['windows_11']), versions: new Set(['v9.9.9']) })
    const options = facetOptions(rows, filters, 'versions', (r) => r.ref.version, filters.versions)
    expect(options).toEqual(['v5.0.0', 'v9.9.9'])
  })

  it('flattens array-valued facets like profile applicability', () => {
    const options = facetOptions(rows, emptyFilters(), 'profiles', (r) => r.profileApplicability, [])
    expect(options).toEqual(['Level 1', 'Level 2'])
  })
})

describe('allFacetValues', () => {
  it('lists every distinct value regardless of any filter', () => {
    expect(allFacetValues(rows, (r) => r.ref.product)).toEqual(['macos_26_tahoe', 'windows_11'])
  })

  it('flattens array-valued facets like profile applicability', () => {
    expect(allFacetValues(rows, (r) => r.profileApplicability)).toEqual(['Level 1', 'Level 2'])
  })

  it('does not change when another filter narrows facetOptions to fewer values', () => {
    // This is the whole point of the function: it's the fixed reference
    // order FilterSidebar renders against, so a value's position never
    // moves as filters make other values reachable/unreachable.
    const filters = emptyFilters({ products: new Set(['windows_11']) })
    const onlyWindowsVersionReachable = facetOptions(rows, filters, 'versions', (r) => r.ref.version, filters.versions)
    expect(onlyWindowsVersionReachable).toEqual(['v5.0.0'])
    expect(allFacetValues(rows, (r) => r.ref.version)).toEqual(['v1.1.0', 'v5.0.0'])
  })
})
