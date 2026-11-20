import type { ManifestSource } from '../types/library'

export interface ProvenanceGroups<Source extends Pick<ManifestSource, 'provenance'>> {
  official: Source[]
  community: Source[]
}

export function groupByProvenance<Source extends Pick<ManifestSource, 'provenance'>>(sources: Source[]): ProvenanceGroups<Source> {
  return {
    official: sources.filter((source) => source.provenance === 'official'),
    community: sources.filter((source) => source.provenance === 'community'),
  }
}
