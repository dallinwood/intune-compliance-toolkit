import { describe, expect, it } from 'vitest'
import {
  EMPTY_RELEASE_LABEL,
  EMPTY_RELEASE_TAG,
  comparisonLocation,
  isEmptyRelease,
  previousReleaseTag,
  releaseLabel,
  resolveComparisonRange,
} from './releaseRange'

const TAGS = ['v1', 'v2', 'v3']

describe('previousReleaseTag', () => {
  it('gives the release before, empty for the first, null for an unknown tag', () => {
    expect(previousReleaseTag(TAGS, 'v3')).toBe('v2')
    expect(previousReleaseTag(TAGS, 'v1')).toBe(EMPTY_RELEASE_TAG)
    expect(previousReleaseTag(TAGS, 'v9')).toBeNull()
  })
})

describe('resolveComparisonRange', () => {
  it('keeps a valid real range and a valid empty range', () => {
    expect(resolveComparisonRange(TAGS, 'v1', 'v3')).toEqual({ fromTag: 'v1', toTag: 'v3' })
    expect(resolveComparisonRange(TAGS, EMPTY_RELEASE_TAG, 'v2')).toEqual({ fromTag: EMPTY_RELEASE_TAG, toTag: 'v2' })
  })

  it('defaults to the last two releases, or empty to the only release', () => {
    expect(resolveComparisonRange(TAGS, null, null)).toEqual({ fromTag: 'v2', toTag: 'v3' })
    expect(resolveComparisonRange(['only'], null, null)).toEqual({ fromTag: EMPTY_RELEASE_TAG, toTag: 'only' })
  })

  it('falls back when From is after To or a tag is unknown', () => {
    const defaultRange = { fromTag: 'v2', toTag: 'v3' }
    expect(resolveComparisonRange(TAGS, 'v3', 'v1')).toEqual(defaultRange)
    expect(resolveComparisonRange(TAGS, 'v2', 'v2')).toEqual(defaultRange)
    expect(resolveComparisonRange(TAGS, 'v9', 'v3')).toEqual(defaultRange)
    expect(resolveComparisonRange(TAGS, 'v1', 'v9')).toEqual(defaultRange)
    expect(resolveComparisonRange(TAGS, 'v1', EMPTY_RELEASE_TAG)).toEqual(defaultRange)
  })

  it('throws for a framework with no releases', () => {
    expect(() => resolveComparisonRange([], null, null)).toThrow()
  })

  it('a real release tagged empty wins over the empty baseline', () => {
    const tags = [EMPTY_RELEASE_TAG, 'v2']
    expect(isEmptyRelease(tags, EMPTY_RELEASE_TAG)).toBe(false)
    expect(isEmptyRelease(TAGS, EMPTY_RELEASE_TAG)).toBe(true)
    expect(previousReleaseTag(tags, EMPTY_RELEASE_TAG)).toBe(EMPTY_RELEASE_TAG)
    expect(resolveComparisonRange(tags, EMPTY_RELEASE_TAG, 'v2')).toEqual({ fromTag: EMPTY_RELEASE_TAG, toTag: 'v2' })
    expect(releaseLabel([{ tag: EMPTY_RELEASE_TAG, label: 'Real one' }], EMPTY_RELEASE_TAG)).toBe('Real one')
  })
})

describe('releaseLabel', () => {
  it('names the empty release and falls back to the tag', () => {
    const releases = [{ tag: 'v1', label: 'Version 1' }]
    expect(releaseLabel(releases, EMPTY_RELEASE_TAG)).toBe(EMPTY_RELEASE_LABEL)
    expect(releaseLabel(releases, 'v1')).toBe('Version 1')
    expect(releaseLabel(releases, 'v7')).toBe('v7')
  })
})

describe('comparisonLocation', () => {
  it('writes framework, from and to in the frameworks path', () => {
    const location = comparisonLocation('nist_800_53', { fromTag: EMPTY_RELEASE_TAG, toTag: 'v1.6.0' }, '/')
    expect(location).toBe('/frameworks?framework=nist_800_53&from=empty&to=v1.6.0')
  })
})
