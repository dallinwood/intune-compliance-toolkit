import { describe, expect, it } from 'vitest'
import type { Applicability } from '../types/library'
import {
  benchmarksAt,
  compareVersionKeys,
  parseVersionKey,
  targetsOf,
  versionKey,
  versionKeysOf,
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
})

describe('versions of different targets', () => {
  const applicability: Applicability = [
    { target: 'macOS', version: '27.0', benchmarks: [{ name: 'cis_lvl1', severity: null }] },
    { target: 'Windows', version: '27.0', benchmarks: [{ name: 'disa_stig', severity: 'high' }] },
  ]

  it('separates versions of different targets', () => {
    expect(versionKeysOf(applicability)).toEqual(['macOS 27.0', 'Windows 27.0'])
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
  const applicability: Applicability = [{ target: null, version: null, benchmarks: [{ name: 'cis_lvl1', severity: null }] }]

  it('skips null versions and keeps null targets', () => {
    expect(targetsOf(applicability)).toEqual([null])
    expect(versionKeysOf(applicability)).toEqual([])
  })

  it('lists each target once, in entry order', () => {
    const entries: Applicability = [
      { target: 'macOS', version: '15.0', benchmarks: [] },
      { target: 'macOS', version: '26.0', benchmarks: [] },
      { target: 'Windows', version: null, benchmarks: [] },
    ]
    expect(targetsOf(entries)).toEqual(['macOS', 'Windows'])
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
