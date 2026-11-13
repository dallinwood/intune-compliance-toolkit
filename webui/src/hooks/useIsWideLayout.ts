import { useSyncExternalStore } from 'react'

// Matches Tailwind's md breakpoint, where the rule table gains its status and
// benchmark columns.
const WIDE_LAYOUT_QUERY = '(min-width: 768px)'

function subscribeToWideLayout(onChange: () => void) {
  const query = window.matchMedia(WIDE_LAYOUT_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

const readWideLayout = () => window.matchMedia(WIDE_LAYOUT_QUERY).matches

export function useIsWideLayout(): boolean {
  return useSyncExternalStore(subscribeToWideLayout, readWideLayout, () => true)
}
