import { useEffect, useState } from 'react'
import { loadReleaseRows } from '../data/ruleRows'
import type { ManifestRelease, ManifestSource } from '../types/library'
import type { RuleRow } from '../types/rule-row'

export type OlderReleaseRows =
  | { release: ManifestRelease; status: 'loading' }
  | { release: ManifestRelease; status: 'error'; message: string }
  | { release: ManifestRelease; status: 'ready'; rows: RuleRow[] }

interface LoadedRows {
  release: ManifestRelease
  outcome: { status: 'error'; message: string } | { status: 'ready'; rows: RuleRow[] }
}

// The rows of the older release a framework's Rules sub-tab browses, fetched
// when it is chosen; null while the current release is shown.
export function useOlderReleaseRows(source: ManifestSource | null, release: ManifestRelease | null): OlderReleaseRows | null {
  const [loaded, setLoaded] = useState<LoadedRows | null>(null)

  useEffect(() => {
    if (source === null || release === null) return
    let isCancelled = false
    loadReleaseRows(source, release).then(
      (rows) => {
        if (!isCancelled) setLoaded({ release, outcome: { status: 'ready', rows } })
      },
      (error: unknown) => {
        if (!isCancelled) setLoaded({ release, outcome: { status: 'error', message: error instanceof Error ? error.message : String(error) } })
      },
    )
    return () => {
      isCancelled = true
    }
  }, [source, release])

  if (source === null || release === null) return null
  // A result for another release (the one chosen before) is not this one's.
  if (loaded === null || loaded.release !== release) return { release, status: 'loading' }
  return { release, ...loaded.outcome }
}
