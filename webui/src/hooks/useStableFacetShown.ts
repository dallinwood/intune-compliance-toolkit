import { useEffect, useRef, useState } from 'react'

// Once a facet value stops being reachable (given the other currently-
// applied filters), it doesn't disappear immediately - it stays in the
// list, disabled/struck-through, for a short quiet period. A run of quick
// filter clicks would otherwise make every facet section reflow under the
// user's cursor after each one. Only once nothing has changed for
// QUIET_PERIOD_MS does the value start actually leaving - and even then it
// fades/collapses out over EXIT_TRANSITION_MS (the caller pairs this with a
// CSS transition of that same duration) rather than snapping away, so the
// facet list reads as settling into place instead of jumping.
// Values becoming newly reachable are added back immediately (and any
// in-progress exit is cancelled) - only the removal side is delayed.
const QUIET_PERIOD_MS = 2400
// Exported so the caller's CSS transition duration can't drift out of sync
// with the timer that actually removes the value from `shown`.
export const FACET_EXIT_TRANSITION_MS = 300

export interface StableFacetShown {
  // Every value that should still be rendered, including ones mid-exit.
  shown: ReadonlySet<string>
  // Subset of `shown` currently mid-exit - the caller applies the
  // fade/collapse CSS classes to these until they're removed from `shown`.
  leaving: ReadonlySet<string>
}

export function useStableFacetShown(reachable: readonly string[]): StableFacetShown {
  const [shown, setShown] = useState<Set<string>>(() => new Set(reachable))
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set())
  const shownRef = useRef(shown)
  const quietTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    shownRef.current = shown
  }, [shown])

  useEffect(() => {
    const reachableSet = new Set(reachable)

    // Reachable again (even mid-exit) -> show it solid immediately, no fade in.
    setShown((current) => {
      let changed = false
      const next = new Set(current)
      for (const value of reachableSet) {
        if (!next.has(value)) {
          next.add(value)
          changed = true
        }
      }
      return changed ? next : current
    })
    setLeaving((current) => {
      let changed = false
      const next = new Set(current)
      for (const value of reachableSet) {
        if (next.delete(value)) changed = true
      }
      return changed ? next : current
    })

    clearTimeout(quietTimerRef.current)
    clearTimeout(exitTimerRef.current)

    quietTimerRef.current = setTimeout(() => {
      const toRemove = Array.from(shownRef.current).filter((value) => !reachableSet.has(value))
      if (toRemove.length === 0) return

      setLeaving((current) => new Set([...current, ...toRemove]))

      exitTimerRef.current = setTimeout(() => {
        setShown((current) => {
          const next = new Set(current)
          toRemove.forEach((value) => next.delete(value))
          return next
        })
        setLeaving((current) => {
          const next = new Set(current)
          toRemove.forEach((value) => next.delete(value))
          return next
        })
      }, FACET_EXIT_TRANSITION_MS)
    }, QUIET_PERIOD_MS)

    return () => {
      clearTimeout(quietTimerRef.current)
      clearTimeout(exitTimerRef.current)
    }
  }, [reachable])

  return { shown, leaving }
}
