import { useEffect, useState } from 'react'
import { fetchOverlayIndex } from '../data/overlays'

export type CustomisedRuleIds = { status: 'loading' } | { status: 'unavailable' } | { status: 'ready'; ruleIds: ReadonlySet<string> }

// The ids of the rules a custom change targets. "Unavailable" when the custom
// changes could not be loaded, so a filter on them is offered no more than it
// is silently emptied.
export function useCustomisedRuleIds(): CustomisedRuleIds {
  const [state, setState] = useState<CustomisedRuleIds>({ status: 'loading' })
  useEffect(() => {
    let cancelled = false
    fetchOverlayIndex()
      .then((loaded) => {
        if (cancelled) return
        // The loader reports its own failures as warnings and an empty index.
        const ruleIds = new Set([...loaded.byRule].filter(([, overlayIds]) => overlayIds.length > 0).map(([ruleId]) => ruleId))
        setState(loaded.overlays.length === 0 && loaded.warnings.length > 0 ? { status: 'unavailable' } : { status: 'ready', ruleIds })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'unavailable' })
      })
    return () => {
      cancelled = true
    }
  }, [])
  return state
}
