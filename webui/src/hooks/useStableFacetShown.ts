import { useEffect, useRef, useState } from 'react'

// Once a facet value stops being reachable (given the other currently-
// applied filters), it doesn't disappear immediately - it stays in the
// list, disabled/struck-through, for a short quiet period. A run of quick
// filter clicks would otherwise make every facet section reflow under the
// user's cursor after each one. Only once nothing has changed for
// QUIET_PERIOD_MS does the value actually drop out of the returned set.
// Values becoming newly reachable are added back immediately - only the
// removal side needs the delay.
const QUIET_PERIOD_MS = 1200

export function useStableFacetShown(reachable: readonly string[]): ReadonlySet<string> {
  const [shown, setShown] = useState<Set<string>>(() => new Set(reachable))
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    setShown((current) => {
      let changed = false
      const next = new Set(current)
      for (const value of reachable) {
        if (!next.has(value)) {
          next.add(value)
          changed = true
        }
      }
      return changed ? next : current
    })

    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setShown(new Set(reachable))
    }, QUIET_PERIOD_MS)

    return () => clearTimeout(timerRef.current)
  }, [reachable])

  return shown
}
