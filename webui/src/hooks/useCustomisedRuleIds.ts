import { useEffect, useState } from 'react'
import { fetchOverlayIndex } from '../data/overlays'

// The ids of the rules a custom change targets; null until the overlay index has loaded.
export function useCustomisedRuleIds(): ReadonlySet<string> | null {
  const [ruleIds, setRuleIds] = useState<ReadonlySet<string> | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchOverlayIndex().then((loaded) => {
      if (!cancelled) setRuleIds(new Set([...loaded.byRule].filter(([, overlayIds]) => overlayIds.length > 0).map(([ruleId]) => ruleId)))
    })
    return () => {
      cancelled = true
    }
  }, [])
  return ruleIds
}
