import type { ManifestSource } from '../../types/library'
import { ExternalLink } from '../layout/AttributionFooter'

export function SourceLine({ source }: { source: ManifestSource }) {
  const rightsHolder = source.license?.rights_holder
  if (!rightsHolder || !source.repository_url) return null
  return (
    <p className="text-xs text-muted-foreground">
      Source: <ExternalLink href={source.repository_url}>{rightsHolder}</ExternalLink>
    </p>
  )
}
