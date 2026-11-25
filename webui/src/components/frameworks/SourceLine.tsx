import type { ManifestSource } from '../../types/library'
import { ExternalLink } from '../layout/AttributionFooter'
import { LicenseBadge } from './LicenseBadge'

export function SourceLine({ source }: { source: ManifestSource }) {
  const rightsHolder = source.license?.rights_holder
  if (!rightsHolder || !source.repository_url) return null
  return (
    <p data-testid="source-line" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>
        Source: <ExternalLink href={source.repository_url}>{rightsHolder}</ExternalLink>
      </span>
      <LicenseBadge license={source.license} />
    </p>
  )
}
