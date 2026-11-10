import { useEffect, useState } from 'react'
import { fetchHistoryIndex } from '../data/history'
import type { HistoryIndex } from '../logic/historyIndex'

export type HistoryIndexState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; index: HistoryIndex }

// The release history of one source, tagged with the source it was loaded for
// so a stale one is never shown after the framework changes.
export function useHistoryIndex(sourceName: string): HistoryIndexState {
  const [loaded, setLoaded] = useState<{ sourceName: string; state: HistoryIndexState } | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchHistoryIndex(sourceName)
      .then((index) => {
        if (!cancelled) setLoaded({ sourceName, state: { status: 'ready', index } })
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoaded({ sourceName, state: { status: 'error', message: error instanceof Error ? error.message : String(error) } })
      })
    return () => {
      cancelled = true
    }
  }, [sourceName])
  return loaded !== null && loaded.sourceName === sourceName ? loaded.state : { status: 'loading' }
}
