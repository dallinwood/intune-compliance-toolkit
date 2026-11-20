import type { ManifestSource } from '../types/library'

export interface ProvenanceGroups<Source extends Pick<ManifestSource, 'provenance'>> {
  official: Source[]
  community: Source[]
}

// Only an explicit 'official' is official: a source with a missing or unknown
// provenance (a manifest that skipped validation) lands in community, so no
// framework is ever left out of the list.
export function groupByProvenance<Source extends Pick<ManifestSource, 'provenance'>>(sources: Source[]): ProvenanceGroups<Source> {
  return {
    official: sources.filter((source) => source.provenance === 'official'),
    community: sources.filter((source) => source.provenance !== 'official'),
  }
}
