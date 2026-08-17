import { describe, expect, it } from 'vitest'
import { naturalIdCompare, topLevelSection } from './naturalId'

describe('naturalIdCompare', () => {
  it('sorts mixed-depth dotted ids numerically per segment, not lexicographically', () => {
    const ids = ['106.1.1', '2.12.2', '1.6', '2.1.1.1']

    const sorted = [...ids].sort(naturalIdCompare)

    expect(sorted).toEqual(['1.6', '2.1.1.1', '2.12.2', '106.1.1'])
  })

  it('treats a shorter id as coming before a longer id that shares its prefix', () => {
    expect(naturalIdCompare('1.1', '1.1.1')).toBeLessThan(0)
  })

  it('falls back to string comparison for non-numeric segments', () => {
    expect(naturalIdCompare('1.a', '1.b')).toBeLessThan(0)
  })
})

describe('topLevelSection', () => {
  it('extracts the first dot-segment of a multi-part id', () => {
    expect(topLevelSection('106.1.1')).toBe('106')
    expect(topLevelSection('2.12.2')).toBe('2')
  })

  it('returns the whole id when it has no dot', () => {
    expect(topLevelSection('6')).toBe('6')
  })
})
