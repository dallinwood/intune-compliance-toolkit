import { useEffect, useState } from 'react'
import { fetchReferencedText } from '../data/referencedFiles'

export type ReferencedTextState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; text: string }

const LOADING: ReferencedTextState = { status: 'loading' }

// Pass null to skip fetching (the hook still has to be called
// unconditionally). The state is tagged with its path so a stale result is
// never shown for another file.
export function useReferencedText(path: string | null): ReferencedTextState {
  const [loaded, setLoaded] = useState<{ path: string; state: ReferencedTextState } | null>(null)

  useEffect(() => {
    if (path === null) return
    let cancelled = false
    fetchReferencedText(path)
      .then((text) => {
        if (!cancelled) setLoaded({ path, state: { status: 'ready', text } })
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoaded({ path, state: { status: 'error', message: error instanceof Error ? error.message : String(error) } })
      })
    return () => {
      cancelled = true
    }
  }, [path])

  return loaded !== null && loaded.path === path ? loaded.state : LOADING
}
