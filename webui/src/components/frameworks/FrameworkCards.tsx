import { cn, isPlainLeftClick } from '@/lib/utils'
import { EMPTY_RELEASE_LABEL, comparisonLocation, previousReleaseTag } from '../../logic/releaseRange'
import { useFilterStore } from '../../state/filterStore'
import type { ManifestSource } from '../../types/library'
import { pluralize } from '../../lib/format'

function accessibleName(label: string, isCurrent: boolean, isFirst: boolean): string {
  if (isFirst) return `${label}: see everything in it, compared with an ${EMPTY_RELEASE_LABEL.toLowerCase()}`
  return isCurrent ? `${label}, current release: see what changed` : `${label}: see what changed`
}

// One card per framework: what is current, and every release kept, each one
// the way into what changed in it.
export function FrameworkCards({ sources }: { sources: ManifestSource[] }) {
  const showComparison = useFilterStore((state) => state.showComparison)
  return (
    <ul className="grid gap-4 p-4 md:grid-cols-2">
      {sources.map((source) => {
        const current = source.releases[source.releases.length - 1]
        const releaseTags = source.releases.map((release) => release.tag)
        return (
          <li key={source.name} data-testid="framework-card" className="space-y-3 rounded-lg border border-border bg-panel p-4">
            <h2 className="text-base font-semibold">{source.display_name}</h2>
            <p className="text-sm text-muted-foreground">
              Current: {current.label} ({current.tag}) · {pluralize(source.rule_count, 'rule', 'rules')}
            </p>
            <p className="text-sm text-muted-foreground">Choose a release to see what changed in it.</p>
            <ul aria-label="Releases" className="flex flex-wrap gap-2">
              {source.releases.map((release, position) => {
                const isCurrent = release.tag === current.tag
                const previousTag = previousReleaseTag(releaseTags, release.tag)!
                const range = { fromTag: previousTag, toTag: release.tag }
                return (
                  <li key={release.tag}>
                    <a
                      href={comparisonLocation(source.name, range, import.meta.env.BASE_URL)}
                      aria-label={accessibleName(release.label, isCurrent, position === 0)}
                      onClick={(event) => {
                        if (!isPlainLeftClick(event)) return
                        event.preventDefault()
                        showComparison(source.name, range.fromTag, range.toTag)
                      }}
                      className={cn(
                        'inline-block rounded-full border px-2.5 py-0.5 text-xs hover:underline focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none',
                        isCurrent
                          ? 'border-transparent bg-primary text-primary-foreground hover:opacity-90'
                          : 'border-border bg-background text-foreground hover:bg-muted',
                      )}
                    >
                      {release.label}
                      {isCurrent && ' · current'}
                    </a>
                  </li>
                )
              })}
            </ul>
          </li>
        )
      })}
    </ul>
  )
}
