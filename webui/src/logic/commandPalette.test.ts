import { describe, expect, it } from 'vitest'
import {
  RULE_RESULT_LIMIT,
  buildPaletteEntries,
  isApplePlatform,
  isPaletteShortcut,
  normalizeQuery,
  resultStatus,
  searchPalette,
  type PaletteEntry,
  type PaletteResults,
} from './commandPalette'

const VIEWS = [
  { id: 'rules', label: 'Rules' },
  { id: 'frameworks', label: 'Frameworks' },
]
const SOURCES = [
  { name: 'cis', display_name: 'CIS Benchmarks' },
  { name: 'nist', display_name: 'NIST macOS Security Baseline' },
]
const SOURCE_LABELS: Record<string, string> = { cis: 'CIS', nist: 'NIST' }

function sourceLabel(sourceName: string): string {
  return SOURCE_LABELS[sourceName] ?? sourceName
}

interface TestRule {
  id: string
  title: string
  sourceName: string
}

function entriesFor(rules: TestRule[]): PaletteEntry[] {
  const rows = rules.map((rule) => ({ ref: { id: rule.id }, title: rule.title, sourceName: rule.sourceName }))
  return buildPaletteEntries(VIEWS, SOURCES, rows, sourceLabel)
}

function ruleIds(results: PaletteResults): string[] {
  return results.rules.map((entry) => (entry.kind === 'rule' ? entry.ruleId : ''))
}

function keyboardEvent(overrides: Partial<Parameters<typeof isPaletteShortcut>[0]> = {}) {
  return {
    key: 'k',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    defaultPrevented: false,
    ...overrides,
  }
}

describe('commandPalette', () => {
  it('builds view, framework and rule entries with keys and match texts', () => {
    const entries = entriesFor([
      { id: 'nist.mSCP.1.2', title: 'Disable AirDrop', sourceName: 'nist' },
      { id: 'cis.1.1', title: 'Enable Firewall', sourceName: 'cis' },
    ])

    expect(entries).toEqual([
      { kind: 'view', key: 'view:rules', viewId: 'rules', label: 'Rules', matchText: 'rules rules' },
      { kind: 'view', key: 'view:frameworks', viewId: 'frameworks', label: 'Frameworks', matchText: 'frameworks frameworks' },
      { kind: 'framework', key: 'framework:cis', sourceName: 'cis', label: 'CIS Benchmarks', shortLabel: 'CIS', matchText: 'cis benchmarks cis cis' },
      {
        kind: 'framework',
        key: 'framework:nist',
        sourceName: 'nist',
        label: 'NIST macOS Security Baseline',
        shortLabel: 'NIST',
        matchText: 'nist macos security baseline nist nist',
      },
      {
        kind: 'rule',
        key: 'rule:cis.1.1',
        ruleId: 'cis.1.1',
        upstreamId: '1.1',
        title: 'Enable Firewall',
        sourceLabel: 'CIS',
        matchText: 'cis.1.1 1.1 enable firewall cis',
      },
      {
        kind: 'rule',
        key: 'rule:nist.mSCP.1.2',
        ruleId: 'nist.mSCP.1.2',
        upstreamId: 'mSCP.1.2',
        title: 'Disable AirDrop',
        sourceLabel: 'NIST',
        matchText: 'nist.mscp.1.2 mscp.1.2 disable airdrop nist',
      },
    ])
  })

  it('an empty query lists views and frameworks only', () => {
    const entries = entriesFor([{ id: 'cis.1.1', title: 'Enable Firewall', sourceName: 'cis' }])

    const results = searchPalette(entries, '   ')

    expect(results.views).toHaveLength(2)
    expect(results.frameworks).toHaveLength(2)
    expect(results.rules).toEqual([])
    expect(results.totalRuleMatches).toBe(0)
  })

  it('every query word must match, in any order', () => {
    const entries = entriesFor([
      { id: 'cis.1.1', title: 'Enable Firewall logging', sourceName: 'cis' },
      { id: 'cis.1.2', title: 'Enable Gatekeeper', sourceName: 'cis' },
    ])

    expect(ruleIds(searchPalette(entries, 'logging  FIREWALL'))).toEqual(['cis.1.1'])
    expect(ruleIds(searchPalette(entries, 'firewall gatekeeper'))).toEqual([])
    expect(searchPalette(entries, 'bench').frameworks.map((entry) => entry.key)).toEqual(['framework:cis'])
    expect(searchPalette(entries, 'rules').views.map((entry) => entry.key)).toEqual(['view:rules'])
  })

  it('an exact upstream id ranks first, then id prefix, title prefix, id substring, others', () => {
    const entries = entriesFor([
      { id: 'cis.x.5', title: 'Other match: contains 5 in title', sourceName: 'cis' },
      { id: 'cis.a5', title: 'Id substring', sourceName: 'cis' },
      { id: 'cis.z', title: '5 minute lock', sourceName: 'cis' },
      { id: 'cis.50', title: 'Id prefix', sourceName: 'cis' },
      { id: 'cis.5', title: 'Exact id', sourceName: 'cis' },
    ])

    expect(ruleIds(searchPalette(entries, '5'))).toEqual(['cis.5', 'cis.50', 'cis.z', 'cis.a5', 'cis.x.5'])
  })

  it('a full id query is an exact match', () => {
    const entries = entriesFor([
      { id: 'cis.5.1', title: 'Other', sourceName: 'cis' },
      { id: 'cis.5', title: 'Cis five', sourceName: 'cis' },
      { id: 'nist.5', title: 'Nist five', sourceName: 'nist' },
    ])

    expect(ruleIds(searchPalette(entries, 'nist.5'))[0]).toBe('nist.5')
  })

  it('ties sort by upstream id with numeric order', () => {
    const entries = entriesFor([
      { id: 'cis.1.10', title: 'Firewall ten', sourceName: 'cis' },
      { id: 'cis.1.2', title: 'Firewall two', sourceName: 'cis' },
      { id: 'cis.1.1', title: 'Firewall one', sourceName: 'cis' },
    ])

    expect(ruleIds(searchPalette(entries, 'firewall'))).toEqual(['cis.1.1', 'cis.1.2', 'cis.1.10'])
  })

  it('rules are capped at the limit with the full match count', () => {
    const rules = Array.from({ length: RULE_RESULT_LIMIT + 7 }, (_, index) => ({
      id: `cis.${index + 1}`,
      title: 'Same title',
      sourceName: 'cis',
    }))
    const entries = entriesFor(rules)

    const results = searchPalette(entries, 'same')
    expect(results.rules).toHaveLength(RULE_RESULT_LIMIT)
    expect(results.totalRuleMatches).toBe(RULE_RESULT_LIMIT + 7)

    const smallerCap = searchPalette(entries, 'same', 3)
    expect(smallerCap.rules).toHaveLength(3)
    expect(smallerCap.totalRuleMatches).toBe(RULE_RESULT_LIMIT + 7)
  })

  it('resultStatus covers none, singular, plural and capped', () => {
    const view: PaletteEntry = { kind: 'view', key: 'view:rules', viewId: 'rules', label: 'Rules', matchText: 'rules rules' }
    const rule: PaletteEntry = {
      kind: 'rule',
      key: 'rule:cis.1',
      ruleId: 'cis.1',
      upstreamId: '1',
      title: 'T',
      sourceLabel: 'CIS',
      matchText: 'cis.1 1 t cis',
    }

    expect(resultStatus({ views: [], frameworks: [], rules: [], totalRuleMatches: 0 })).toBe('No matches')
    expect(resultStatus({ views: [view], frameworks: [], rules: [], totalRuleMatches: 0 })).toBe('1 result')
    expect(resultStatus({ views: [view], frameworks: [], rules: [rule], totalRuleMatches: 1 })).toBe('2 results')
    expect(resultStatus({ views: [], frameworks: [], rules: [rule], totalRuleMatches: 120 })).toBe(
      'Showing 1 of 120 rules; keep typing to narrow',
    )
  })

  it('normalizeQuery lower-cases, trims and collapses whitespace', () => {
    expect(normalizeQuery('  Mac   OS\tFirewall ')).toBe('mac os firewall')
  })

  it('isPaletteShortcut accepts Ctrl+K and Cmd+K, rejects Alt, Shift, composing and prevented', () => {
    expect(isPaletteShortcut(keyboardEvent())).toBe(true)
    expect(isPaletteShortcut(keyboardEvent({ key: 'K' }))).toBe(true)
    expect(isPaletteShortcut(keyboardEvent({ ctrlKey: false, metaKey: true }))).toBe(true)
    expect(isPaletteShortcut(keyboardEvent({ ctrlKey: false }))).toBe(false)
    expect(isPaletteShortcut(keyboardEvent({ key: 'j' }))).toBe(false)
    expect(isPaletteShortcut(keyboardEvent({ altKey: true }))).toBe(false)
    expect(isPaletteShortcut(keyboardEvent({ shiftKey: true }))).toBe(false)
    expect(isPaletteShortcut(keyboardEvent({ isComposing: true }))).toBe(false)
    expect(isPaletteShortcut(keyboardEvent({ defaultPrevented: true }))).toBe(false)
  })

  it('isApplePlatform detects Mac and iOS platforms and falls back to the user agent', () => {
    expect(isApplePlatform('MacIntel', '')).toBe(true)
    expect(isApplePlatform('iPhone', '')).toBe(true)
    expect(isApplePlatform('iPad', '')).toBe(true)
    expect(isApplePlatform('Win32', 'Mozilla/5.0 (Macintosh)')).toBe(false)
    expect(isApplePlatform('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe(true)
    expect(isApplePlatform('', 'Mozilla/5.0 (Windows NT 10.0)')).toBe(false)
  })
})
