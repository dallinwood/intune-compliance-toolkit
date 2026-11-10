import type { Manifest } from '../types/library'

let cachedManifest: Promise<Manifest> | null = null
let loadedManifest: Manifest | null = null

// The manifest once it has loaded, for a component that must know a fact from
// it on its first render (the app has loaded it before any rule is shown).
export function loadedManifestOrNull(): Manifest | null {
  return loadedManifest
}

// Cached per session - the manifest is static build output, so there's no
// reason to refetch it after the first successful load.
export function fetchManifest(): Promise<Manifest> {
  if (!cachedManifest) {
    cachedManifest = fetch(`${import.meta.env.BASE_URL}baselines/_manifest.json`).then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load baseline manifest (${response.status} ${response.statusText})`)
      }
      return response.json() as Promise<Manifest>
    }).then((manifest) => {
      loadedManifest = manifest
      return manifest
    })
  }
  return cachedManifest
}
