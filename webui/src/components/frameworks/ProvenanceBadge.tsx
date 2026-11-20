import { Badge } from '@/components/ui/badge'
import type { ManifestSource } from '../../types/library'

const PROVENANCE_LABELS: Record<ManifestSource['provenance'], string> = {
  official: 'Official',
  community: 'Community',
}

export function ProvenanceBadge({ provenance }: { provenance: ManifestSource['provenance'] }) {
  return <Badge variant={provenance === 'official' ? 'secondary' : 'outline'}>{PROVENANCE_LABELS[provenance]}</Badge>
}
