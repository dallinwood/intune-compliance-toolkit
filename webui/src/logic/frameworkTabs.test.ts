import { describe, expect, it } from 'vitest'
import type { FrameworkPair } from './frameworkPairs'
import { frameworkHasPairs, resolveFrameworkPage, resolveFrameworkTab } from './frameworkTabs'

describe('resolveFrameworkTab', () => {
  it('sends the all-rules page to rules whatever tab it asks for', () => {
    expect(resolveFrameworkTab('coverage', true, true)).toBe('rules')
    expect(resolveFrameworkTab('releases', true, true)).toBe('rules')
  })

  it('sends coverage to rules on a framework with no pairs', () => {
    expect(resolveFrameworkTab('coverage', false, false)).toBe('rules')
  })

  it('sends a missing tab to rules', () => {
    expect(resolveFrameworkTab(null, false, true)).toBe('rules')
    expect(resolveFrameworkTab(null, true, false)).toBe('rules')
  })

  it('keeps a tab the page has', () => {
    expect(resolveFrameworkTab('coverage', false, true)).toBe('coverage')
    expect(resolveFrameworkTab('releases', false, false)).toBe('releases')
    expect(resolveFrameworkTab('rules', true, false)).toBe('rules')
  })
})

describe('frameworkHasPairs', () => {
  const pairs: FrameworkPair[] = [
    { kind: 'supports', coveringSource: 'mscp', coveredSource: 'nist' },
    { kind: 'related', sources: ['asd_e4eit', 'asd_ism'] },
  ]

  it('finds a framework on either side of a supports pair and in a related pair', () => {
    expect(frameworkHasPairs(pairs, 'mscp')).toBe(true)
    expect(frameworkHasPairs(pairs, 'nist')).toBe(true)
    expect(frameworkHasPairs(pairs, 'asd_ism')).toBe(true)
    expect(frameworkHasPairs(pairs, 'cis')).toBe(false)
  })
})

describe('resolveFrameworkPage', () => {
  const mscp = { name: 'mscp' }
  const cis = { name: 'cis' }
  const pairs: FrameworkPair[] = [{ kind: 'supports', coveringSource: 'mscp', coveredSource: 'nist' }]

  it('is the grid for no framework or an unknown one', () => {
    expect(resolveFrameworkPage(null, 'rules', [mscp], pairs)).toBeNull()
    expect(resolveFrameworkPage('nonsense', 'rules', [mscp], pairs)).toBeNull()
  })

  it('resolves the all-rules page to its only tab', () => {
    expect(resolveFrameworkPage('all', 'coverage', [mscp], pairs)).toEqual({ source: 'all', tab: 'rules', hasCoverage: false })
  })

  it('resolves a framework page with or without a Coverage sub-tab', () => {
    expect(resolveFrameworkPage('mscp', 'coverage', [mscp, cis], pairs)).toEqual({ source: mscp, tab: 'coverage', hasCoverage: true })
    expect(resolveFrameworkPage('cis', 'coverage', [mscp, cis], pairs)).toEqual({ source: cis, tab: 'rules', hasCoverage: false })
  })
})
