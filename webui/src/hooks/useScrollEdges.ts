import { useCallback, useEffect, useState, type RefObject } from 'react'

export interface ScrollEdges {
  canScrollUp: boolean
  canScrollDown: boolean
}

// Fractional scroll positions (zoom, high-DPI) can leave the container a
// sub-pixel short of its true end, so one pixel counts as "at the edge".
const EDGE_TOLERANCE_PX = 1

export function scrollEdges(scrollTop: number, clientHeight: number, scrollHeight: number): ScrollEdges {
  return {
    canScrollUp: scrollTop > EDGE_TOLERANCE_PX,
    canScrollDown: scrollTop + clientHeight < scrollHeight - EDGE_TOLERANCE_PX,
  }
}

// Tracks whether the container has more content above and below. Re-measures
// on scroll, on container resize, and on content resize (children growing or
// shrinking, e.g. a facet collapsing out) - hence observing every child too.
export function useScrollEdges(containerRef: RefObject<HTMLElement | null>): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ canScrollUp: false, canScrollDown: false })

  const measure = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const next = scrollEdges(container.scrollTop, container.clientHeight, container.scrollHeight)
    setEdges((previous) =>
      previous.canScrollUp === next.canScrollUp && previous.canScrollDown === next.canScrollDown ? previous : next,
    )
  }, [containerRef])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    measure()
    container.addEventListener('scroll', measure, { passive: true })
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(container)
    const observeChildren = () => Array.from(container.children).forEach((child) => resizeObserver.observe(child))
    observeChildren()
    // Children added or removed after mount need observing too.
    const mutationObserver = new MutationObserver(() => {
      observeChildren()
      measure()
    })
    mutationObserver.observe(container, { childList: true })

    return () => {
      container.removeEventListener('scroll', measure)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [containerRef, measure])

  return edges
}
