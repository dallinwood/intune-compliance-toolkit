export interface ThirdPartyPackage {
  name: string
  version: string
  license: string
  licenseText: string
  repository?: string
}

let pendingPackages: Promise<ThirdPartyPackage[]> | null = null

// Written by the thirdPartyLicences Vite plugin. A failure is not cached, so
// reopening the dialog retries.
export function fetchThirdPartyPackages(): Promise<ThirdPartyPackage[]> {
  if (!pendingPackages) {
    pendingPackages = fetch(`${import.meta.env.BASE_URL}third-party-licences.json`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load the package licences (${response.status} ${response.statusText})`)
        }
        return response.json() as Promise<ThirdPartyPackage[]>
      })
      .catch((error: unknown) => {
        pendingPackages = null
        throw error
      })
  }
  return pendingPackages
}
