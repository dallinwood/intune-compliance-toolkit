import { Button } from '@/components/ui/button'
import { useSelectionStore } from '../../state/selectionStore'

// Saved selections can outlive their rule: a re-import may drop or rename
// one. They are left out of counts and generation, and listed here so the
// admin knows and can remove them.
export function StaleSelectionsNotice({ unknownIds }: { unknownIds: string[] }) {
  const removeSelections = useSelectionStore((store) => store.removeSelections)
  if (unknownIds.length === 0) return null

  return (
    <div
      role="status"
      aria-label="Saved selections not in this library"
      className="mx-4 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
    >
      <p className="min-w-0 flex-1 basis-64 break-words">
        {unknownIds.length} saved selection{unknownIds.length === 1 ? ' is' : 's are'} no longer in this library:{' '}
        {unknownIds.map((id, index) => (
          <span key={id}>
            {index > 0 && ', '}
            <span className="font-mono break-all">{id}</span>
          </span>
        ))}
        . They are left out of the selection count and the bundle.
      </p>
      <Button type="button" size="xs" variant="outline" onClick={() => removeSelections(unknownIds)}>
        Remove {unknownIds.length === 1 ? 'it' : 'them'}
      </Button>
    </div>
  )
}
