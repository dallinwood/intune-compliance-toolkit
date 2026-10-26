import { Badge } from '@/components/ui/badge'

// Marks content a maintainer overlay added or changed, so it is never shown
// as if the upstream source wrote it.
export function CustomTag({ className = '' }: { className?: string }) {
  return (
    <Badge className={`bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 ${className}`} title="Added by a maintainer overlay, not by the upstream source">
      Custom
    </Badge>
  )
}
