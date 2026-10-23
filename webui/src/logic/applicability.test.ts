import { describe, expect, it } from 'vitest'
import type { Applicability } from '../types/library'
import {
  NO_TARGET_KEY,
  NO_VERSION_KEY,
  benchmarksAt,
  compareScopeKeys,
  compareVersionKeys,
  parseVersionKey,
  scopeKeysOf,
  targetKeysOf,
  versionKey,
  versionsForTarget,
} from './applicability'
import { termLabel } from './vocabulary'
import { committedVocabularyIndex } from './testVocabularyFixtures'

describe('versionKey and parseVersionKey', () => {
  it('joins a target and a version with a space', () => {
    expect(versionKey('macOS', '27.0')).toBe('macOS 27.0')
  })

  it('parses a target containing a space', () => {
    expect(parseVersionKey('Microsoft 365 2026.1')).toEqual({ target: 'Microsoft 365', version: '2026.1' })
  })

  it('parses a key with no space as a bare version rather than slicing it wrongly', () => {
    expect(parseVersionKey('27.0')).toEqual({ target: '', version: '27.0' })
  })
})

describe('versions of different targets', () => {
  const applicability: Applicability = [
    { target: 'macOS', version: '27.0', benchmarks: [{ name: 'cis_lvl1', severity: null }] },
    { target: 'Windows', version: '27.0', benchmarks: [{ name: 'disa_stig', severity: 'high' }] },
  ]

  it('separates versions of different targets', () => {
    expect(scopeKeysOf(applicability)).toEqual(['macOS 27.0', 'Windows 27.0'])
    expect(benchmarksAt(applicability, 'macOS 27.0')).toEqual([{ name: 'cis_lvl1', severity: null }])
    expect(benchmarksAt(applicability, 'Windows 27.0')).toEqual([{ name: 'disa_stig', severity: 'high' }])
  })

  it('returns no benchmarks for a key the rule does not list', () => {
    expect(benchmarksAt(applicability, 'macOS 15.0')).toEqual([])
  })

  it('lists the bare versions of one target', () => {
    expect(versionsForTarget(applicability, 'Windows')).toEqual(['27.0'])
    expect(versionsForTarget(applicability, 'Linux')).toEqual([])
  })
})

describe('compareVersionKeys', () => {
  it('orders keys by target then newest version', () => {
    expect(['Windows 9.0', 'macOS 15.0', 'macOS 27.0'].sort(compareVersionKeys)).toEqual([
      'macOS 27.0',
      'macOS 15.0',
      'Windows 9.0',
    ])
  })
})

describe('entries without a version or a target', () => {
  const ismApplicability: Applicability = [
    {
      target: null,
      version: null,
      benchmarks: [
        { name: 'ism_protected', severity: null },
        { name: 'e8_ml3', severity: null },
      ],
    },
  ]

  it('gives an ISM-shaped entry the "none" scope key and its benchmarks', () => {
    expect(scopeKeysOf(ismApplicability)).toEqual([NO_VERSION_KEY])
    expect(NO_VERSION_KEY).toBe('none')
    expect(targetKeysOf(ismApplicability)).toEqual([NO_TARGET_KEY])
    expect(NO_TARGET_KEY).toBe('none')
    expect(benchmarksAt(ismApplicability, NO_VERSION_KEY)).toEqual([
      { name: 'ism_protected', severity: null },
      { name: 'e8_ml3', severity: null },
    ])
  })

  it('lists each target once, in entry order', () => {
    const entries: Applicability = [
      { target: 'macOS', version: '15.0', benchmarks: [] },
      { target: 'macOS', version: '26.0', benchmarks: [] },
      { target: 'Windows', version: null, benchmarks: [] },
    ]
    expect(targetKeysOf(entries)).toEqual(['macOS', 'Windows'])
  })

  it('mixes versioned, version-less and target-less entries, with "none" last', () => {
    const mixed: Applicability = [
      { target: null, version: null, benchmarks: [{ name: 'e8_ml1', severity: null }] },
      { target: 'macOS', version: null, benchmarks: [{ name: 'cis_lvl1', severity: null }] },
      { target: 'macOS', version: '26.0', benchmarks: [] },
      { target: 'macOS', version: '27.0', benchmarks: [] },
    ]
    expect(scopeKeysOf(mixed)).toEqual(['macOS 27.0', 'macOS 26.0', NO_VERSION_KEY])
    expect(targetKeysOf(mixed)).toEqual([NO_TARGET_KEY, 'macOS'])
    expect(benchmarksAt(mixed, NO_VERSION_KEY)).toEqual([
      { name: 'e8_ml1', severity: null },
      { name: 'cis_lvl1', severity: null },
    ])
  })

  it('lists a version-less macOS entry as "none" without benchmarks', () => {
    const versionless: Applicability = [{ target: 'macOS', version: null, benchmarks: [] }]
    expect(scopeKeysOf(versionless)).toEqual([NO_VERSION_KEY])
    expect(targetKeysOf(versionless)).toEqual(['macOS'])
    expect(benchmarksAt(versionless, NO_VERSION_KEY)).toEqual([])
  })

  it('de-duplicates benchmarks repeated across version-less entries by name and severity', () => {
    const repeated: Applicability = [
      { target: null, version: null, benchmarks: [{ name: 'e8_ml1', severity: null }] },
      {
        target: 'macOS',
        version: null,
        benchmarks: [
          { name: 'e8_ml1', severity: null },
          { name: 'disa_stig', severity: 'high' },
          { name: 'disa_stig', severity: 'low' },
        ],
      },
    ]
    expect(benchmarksAt(repeated, NO_VERSION_KEY)).toEqual([
      { name: 'e8_ml1', severity: null },
      { name: 'disa_stig', severity: 'high' },
      { name: 'disa_stig', severity: 'low' },
    ])
  })
})

describe('compareScopeKeys', () => {
  it('orders version keys as compareVersionKeys does and puts "none" last', () => {
    expect([NO_VERSION_KEY, 'Windows 9.0', 'macOS 15.0', 'macOS 27.0'].sort(compareScopeKeys)).toEqual([
      'macOS 27.0',
      'macOS 15.0',
      'Windows 9.0',
      NO_VERSION_KEY,
    ])
  })
})

describe('version labels', () => {
  it('an unlabelled version falls back to its key', () => {
    expect(termLabel(committedVocabularyIndex(), 'versions', 'macOS 28.0')).toBe('macOS 28.0')
  })

  it('a labelled version shows its label', () => {
    expect(termLabel(committedVocabularyIndex(), 'versions', 'macOS 27.0')).toBe('macOS 27')
  })
})
