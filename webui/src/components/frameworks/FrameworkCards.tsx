import { isPlainLeftClick } from '@/lib/utils'
import { EMPTY_RELEASE_LABEL, comparisonLocation, previousReleaseTag } from '../../logic/releaseRange'
import { useFilterStore } from '../../state/filterStore'
import type { ManifestSource } from '../../types/library'
import { formatCount, pluralize } from '../../lib/format'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { CardCoverage } from '../../logic/cardCoverage'
import { capCount, type CappedCoverage } from '../../logic/frameworkPairs'
import { cappedBarLabel } from '../../logic/selectionCoverage'
import { termLabel } from '../../logic/vocabulary'
import { hrefForFrameworkPage } from '../../state/filterStore'
import { ALL_FRAMEWORKS, type FrameworkTab } from '../../state/urlState'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import { CoverageBar } from '../selectionCoverage/CoverageBar'

function accessibleName(label: string, isCurrent: boolean, isFirst: boolean): string {
  if (isFirst) return `${label}: see everything in it, compared with an ${EMPTY_RELEASE_LABEL.toLowerCase()}`
  return isCurrent ? `${label}, current release: see what changed` : `${label}: see what changed`
}

function FrameworkPageLink({ framework, tab, children, variant = 'outline' }: { framework: string; tab: FrameworkTab; children: string; variant?: 'outline' | 'link' }) {
  const filterState = useFilterStore()
  return (
    <a
      href={hrefForFrameworkPage(filterState, framework, tab)}
      onClick={(event) => {
        if (!isPlainLeftClick(event)) return
        event.preventDefault()
        filterState.setFrameworkPage(framework, tab)
      }}
      className={cn(buttonVariants({ variant, size: 'xs' }))}
    >
      {children}
    </a>
  )
}

function CompactCappedBar({ title, capped }: { title: string; capped: CappedCoverage }) {
  const maximum = capCount(capped.cap)
  const { selection } = capped
  return (
    <div className="space-y-0.5">
      <p className="flex flex-wrap justify-between gap-x-3 text-xs">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">
          {formatCount(capCount(selection))} of {formatCount(selection.total)} controls
        </span>
      </p>
      <CoverageBar
        covered={selection.covered}
        coveredThroughSupporting={selection.coveredThroughSupporting}
        relatedOnly={selection.relatedOnly}
        total={selection.total}
        label={`${title}: ${cappedBarLabel(selection, maximum)}`}
        capCount={maximum}
        capLabel={`max ${formatCount(maximum)}`}
      />
    </div>
  )
}

const RELATED_NOT_COVERAGE_NOTE = 'linked as related, not counted as coverage'

function CardCoverageBlock({ coverage }: { coverage: CardCoverage }) {
  const vocabularyIndex = useVocabularyIndex()
  const sourceLabel = (name: string) => termLabel(vocabularyIndex, 'sources', name)
  return (
    <div data-testid="card-coverage" className="space-y-4 border-t border-border pt-3">
      {coverage.covers.map(({ coveredSource, capped }) => (
        <CompactCappedBar key={`covers:${coveredSource}`} title={`Supports ${sourceLabel(coveredSource)}`} capped={capped} />
      ))}
      {coverage.coveredBy.map(({ coveringSource, capped }) => (
        <CompactCappedBar key={`covered-by:${coveringSource}`} title={`Supported by ${sourceLabel(coveringSource)}`} capped={capped} />
      ))}
      {coverage.related.map(({ otherSource, coverage: relatedCoverage }) => (
        <div key={`related:${otherSource}`} className="space-y-0.5">
          <p className="flex flex-wrap justify-between gap-x-3 text-xs">
            <span className="font-medium">Related to {sourceLabel(otherSource)}</span>
            <span className="text-muted-foreground">{formatCount(relatedCoverage.relatedOnly)} related only</span>
          </p>
          <p className="text-xs text-muted-foreground">{RELATED_NOT_COVERAGE_NOTE}</p>
        </div>
      ))}
      {coverage.combined !== null && (
        <div className="border-t border-border pt-3">
          <CompactCappedBar title="All mapped frameworks" capped={coverage.combined} />
        </div>
      )}
    </div>
  )
}

function hasCoverageBlock(coverage: CardCoverage | undefined): coverage is CardCoverage {
  return coverage !== undefined && coverage.covers.length + coverage.coveredBy.length + coverage.related.length > 0
}

// The home grid: a way into every rule, then one card per framework with what is current, a
// compact coverage summary, and every release kept, each one the way into what changed in it.
export function FrameworkCards({ sources, coverageBySource }: { sources: ManifestSource[]; coverageBySource: ReadonlyMap<string, CardCoverage> }) {
  const showComparison = useFilterStore((state) => state.showComparison)
  return (
    <div>
      <div className="px-4 pt-4">
        <FrameworkPageLink framework={ALL_FRAMEWORKS} tab="rules" variant="link">
          Browse all rules
        </FrameworkPageLink>
      </div>
      <ul className="grid gap-4 p-4 md:grid-cols-2">
      {sources.map((source) => {
        const current = source.releases[source.releases.length - 1]
        const releaseTags = source.releases.map((release) => release.tag)
        const coverage = coverageBySource.get(source.name)
        const hasPairs = hasCoverageBlock(coverage)
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
                      className={buttonVariants({ variant: isCurrent ? 'default' : 'outline', size: 'xs' })}
                    >
                      {release.label}
                      {isCurrent && ' · current'}
                    </a>
                  </li>
                )
              })}
            </ul>
            {hasCoverageBlock(coverage) && <CardCoverageBlock coverage={coverage} />}
            <div className="flex gap-2">
              <FrameworkPageLink framework={source.name} tab="rules">
                Rules
              </FrameworkPageLink>
              {hasPairs && (
                <FrameworkPageLink framework={source.name} tab="coverage">
                  Coverage
                </FrameworkPageLink>
              )}
            </div>
          </li>
        )
      })}
      </ul>
    </div>
  )
}
