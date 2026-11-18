import { describe, expect, it } from 'vitest'
import { splitReleases } from './cardReleases'

describe('splitReleases', () => {
  it('puts the oldest release of five in the older list and keeps the newest four visible', () => {
    expect(splitReleases(['a', 'b', 'c', 'd', 'e'])).toEqual({ older: ['a'], visible: ['b', 'c', 'd', 'e'] })
  })

  it('has no older releases at four or fewer', () => {
    expect(splitReleases(['a', 'b', 'c', 'd'])).toEqual({ older: [], visible: ['a', 'b', 'c', 'd'] })
    expect(splitReleases(['a'])).toEqual({ older: [], visible: ['a'] })
    expect(splitReleases([])).toEqual({ older: [], visible: [] })
  })

  it('honours another visible count', () => {
    expect(splitReleases(['a', 'b', 'c'], 1)).toEqual({ older: ['a', 'b'], visible: ['c'] })
  })
})
