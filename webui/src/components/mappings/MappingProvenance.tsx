import { Badge } from '@/components/ui/badge'
import { useRuleMappings } from '../../state/mappingsContext'

// Where a mapping link comes from: its note, then the mapping file's id and
// whether that file is generated or hand-written. Shared by the Mapped rules
// rows and the Coverage view so the two cannot drift apart.
export function MappingProvenance({ mapping, note }: { mapping: string; note: string | null }) {
  const { mappingFiles } = useRuleMappings()
  const fileInfo = mappingFiles.get(mapping)
  return (
    <>
      {note !== null && <p className="break-words text-muted-foreground">{note}</p>}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
        <span className="font-mono break-all">{mapping}</span>
        {fileInfo !== undefined && <Badge variant="outline">{fileInfo.generatedBy === null ? 'Hand-written' : 'Generated'}</Badge>}
      </p>
    </>
  )
}
