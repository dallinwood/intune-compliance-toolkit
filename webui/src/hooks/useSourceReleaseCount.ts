import { useEffect, useState } from 'react'
import { fetchManifest, loadedManifestOrNull } from '../data/manifest'
import type { Manifest } from '../types/library'

function releaseCountOf(manifest: Manifest | null, sourceName: string): number | null {
  return manifest?.sources.find((source) => source.name === sourceName)?.releases.length ?? null
}

// How many releases of a source the manifest lists, known on the first render
// once the app has loaded the manifest; null while it is still unknown.
export function useSourceReleaseCount(sourceName: string | null): number | null {
  const [manifest, setManifest] = useState<Manifest | null>(loadedManifestOrNull)
  useEffect(() => {
    if (manifest !== null) return
    let cancelled = false
    fetchManifest()
      .then((loaded) => {
        if (!cancelled) setManifest(loaded)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [manifest])
  return sourceName === null ? null : releaseCountOf(manifest, sourceName)
}
