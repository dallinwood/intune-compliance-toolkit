import { describe, expect, it } from 'vitest'
import { scrollEdges } from './useScrollEdges'

describe('scrollEdges', () => {
  it('reports nothing to scroll when the content fits', () => {
    expect(scrollEdges(0, 400, 400)).toEqual({ canScrollUp: false, canScrollDown: false })
  })

  it('can only scroll down at the top', () => {
    expect(scrollEdges(0, 400, 900)).toEqual({ canScrollUp: false, canScrollDown: true })
  })

  it('can scroll both ways in the middle', () => {
    expect(scrollEdges(200, 400, 900)).toEqual({ canScrollUp: true, canScrollDown: true })
  })

  it('can only scroll up at the bottom', () => {
    expect(scrollEdges(500, 400, 900)).toEqual({ canScrollUp: true, canScrollDown: false })
  })

  it('tolerates one pixel of rounding at either end', () => {
    expect(scrollEdges(1, 400, 900)).toEqual({ canScrollUp: false, canScrollDown: true })
    expect(scrollEdges(499, 400, 900)).toEqual({ canScrollUp: true, canScrollDown: false })
    expect(scrollEdges(2, 400, 900).canScrollUp).toBe(true)
    expect(scrollEdges(498, 400, 900).canScrollDown).toBe(true)
  })
})
