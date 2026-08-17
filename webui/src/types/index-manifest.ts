export interface ManifestEntry {
  family: string
  product: string
  version: string
  platform: string
  indexPath: string
  ruleCount: number
}

export interface Manifest {
  schemaVersion: number
  baselines: ManifestEntry[]
}
