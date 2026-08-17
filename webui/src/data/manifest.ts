import type { Manifest } from '../types/index-manifest'

let cachedManifest: Promise<Manifest> | null = null

// Cached per session - the manifest is static build output, so there's no
// reason to refetch it after the first successful load.
export function fetchManifest(): Promise<Manifest> {
  if (!cachedManifest) {
    cachedManifest = fetch(`${import.meta.env.BASE_URL}baselines/_manifest.json`).then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load baseline manifest (${response.status} ${response.statusText})`)
      }
      return response.json() as Promise<Manifest>
    })
  }
  return cachedManifest
}
