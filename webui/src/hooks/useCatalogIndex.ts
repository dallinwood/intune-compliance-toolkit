import { useEffect, useState } from 'react'
import { loadCatalogIndex, type LoadedCatalogIndex } from '../data/catalog'

// One fetch per page load, shared by every catalog tab; started the first time
// a catalog tab asks for it, so the Rules tab never requests the catalog.
let catalogRequest: Promise<LoadedCatalogIndex> | null = null

function requestCatalogOnce(): Promise<LoadedCatalogIndex> {
  catalogRequest ??= loadCatalogIndex()
  return catalogRequest
}

// Null while loading.
export function useCatalogIndex(): LoadedCatalogIndex | null {
  const [loaded, setLoaded] = useState<LoadedCatalogIndex | null>(null)
  useEffect(() => {
    let cancelled = false
    requestCatalogOnce().then((result) => {
      if (!cancelled) setLoaded(result)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return loaded
}
