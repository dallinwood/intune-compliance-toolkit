import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useFilterStore } from '../../state/filterStore'
import type { ManifestSource } from '../../types/library'

const ONLY_ONE_RELEASE = 'Only one release imported'

// One card per framework: what is current, every release kept, and the way
// into comparing two of them.
export function FrameworkCards({ sources }: { sources: ManifestSource[] }) {
  const showComparison = useFilterStore((state) => state.showComparison)
  return (
    <ul className="grid gap-4 p-4 md:grid-cols-2">
      {sources.map((source) => {
        const current = source.releases[source.releases.length - 1]
        const previous = source.releases.length > 1 ? source.releases[source.releases.length - 2] : null
        return (
          <li key={source.name} data-testid="framework-card" className="space-y-3 rounded-lg border border-border bg-panel p-4">
            <h2 className="text-base font-semibold">{source.display_name}</h2>
            <p className="text-sm text-muted-foreground">
              Current: {current.label} ({current.tag}) · {source.rule_count} rules
            </p>
            <ul aria-label="Releases" className="flex flex-wrap gap-2">
              {source.releases.map((release) => {
                const isCurrent = release.tag === current.tag
                return (
                  <li
                    key={release.tag}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-xs',
                      isCurrent ? 'border-transparent bg-primary text-primary-foreground' : 'border-border bg-background text-foreground',
                    )}
                  >
                    {release.label}
                    {isCurrent && ' · current'}
                  </li>
                )
              })}
            </ul>
            <button
              type="button"
              disabled={previous === null}
              title={previous === null ? ONLY_ONE_RELEASE : undefined}
              onClick={() => previous !== null && showComparison(source.name, previous.tag, current.tag)}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Compare releases
            </button>
          </li>
        )
      })}
    </ul>
  )
}
