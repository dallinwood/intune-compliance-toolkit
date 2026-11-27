import { ChevronDown, ChevronUp } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useScrollEdges } from '@/hooks/useScrollEdges'
import { splitReleases } from '../../logic/cardReleases'
import { groupByProvenance } from '../../logic/provenanceGroups'
import { EMPTY_RELEASE_LABEL, comparisonLocation, previousReleaseTag } from '../../logic/releaseRange'
import type { ManifestSource } from '../../types/library'
import { formatCount, pluralize } from '../../lib/format'
import { buttonVariants } from '@/components/ui/button'
import { Menu, MenuContent, MenuLinkItem, MenuTrigger } from '@/components/ui/menu'
import { cn, isPlainLeftClick } from '@/lib/utils'
import type { CardCoverage } from '../../logic/cardCoverage'
import { capCount, type CappedCoverage } from '../../logic/frameworkPairs'
import { cappedBarLabel } from '../../logic/selectionCoverage'
import { termLabel } from '../../logic/vocabulary'
import { hrefForFrameworkPage, useFilterStore } from '../../state/filterStore'
import { ALL_FRAMEWORKS, type FrameworkTab } from '../../state/urlState'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import { CoverageBar } from '../selectionCoverage/CoverageBar'
import { ProvenanceBadge } from './ProvenanceBadge'
import { SourceLine } from './SourceLine'

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
      className={cn(buttonVariants({ variant, size: 'sm' }))}
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

// Cards line up better when no coverage section outgrows the busiest one today (three bars);
// a longer one scrolls inside its card until opened.
const MAXIMUM_VISIBLE_COVERAGE_BARS = 3

function CappedCoverageList({ items }: { items: { key: string; node: ReactNode }[] }) {
  const listRef = useRef<HTMLDivElement>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [cappedHeight, setCappedHeight] = useState<number | null>(null)
  const { canScrollUp, canScrollDown } = useScrollEdges(listRef)
  const canExpand = items.length > MAXIMUM_VISIBLE_COVERAGE_BARS
  const isCapped = canExpand && !isExpanded

  // The cap is measured, not fixed, because a related bar carries an extra note line.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!isCapped || !list) {
      setCappedHeight(null)
      return
    }
    const measure = () => {
      const lastVisibleItem = list.children[MAXIMUM_VISIBLE_COVERAGE_BARS - 1] as HTMLElement | undefined
      if (lastVisibleItem) setCappedHeight(lastVisibleItem.offsetTop + lastVisibleItem.offsetHeight)
    }
    measure()
    const resizeObserver = new ResizeObserver(measure)
    Array.from(list.children).forEach((child) => resizeObserver.observe(child))
    return () => resizeObserver.disconnect()
  }, [isCapped, items.length])

  const collapse = () => {
    setIsExpanded(false)
    listRef.current?.scrollTo({ top: 0 })
  }

  return (
    <div>
      <div className="relative">
        <div
          ref={listRef}
          data-testid="card-coverage-list"
          className={cn('relative space-y-4', isCapped && 'overflow-y-auto')}
          style={isCapped && cappedHeight !== null ? { maxHeight: cappedHeight } : undefined}
          {...(isCapped ? { tabIndex: 0, role: 'region', 'aria-label': 'Coverage bars (scroll for more)' } : {})}
        >
          {items.map(({ key, node }) => (
            <div key={key}>{node}</div>
          ))}
        </div>
        {isCapped && (
          <>
            <div
              aria-hidden="true"
              data-testid="card-coverage-fade-up"
              className={cn(
                'pointer-events-none absolute inset-x-0 top-0 flex h-8 items-start justify-center bg-gradient-to-b from-panel to-transparent transition-opacity duration-200',
                canScrollUp ? 'opacity-100' : 'opacity-0',
              )}
            >
              <ChevronUp className="size-4 text-muted-foreground" />
            </div>
            {canScrollDown && (
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                aria-label={`Show all ${items.length} coverage bars`}
                className="absolute inset-x-0 bottom-0 flex h-8 cursor-pointer items-end justify-center rounded-b-md bg-gradient-to-t from-panel to-transparent outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" />
              </button>
            )}
          </>
        )}
      </div>
      {canExpand && isExpanded && (
        <button
          type="button"
          onClick={collapse}
          aria-label="Show fewer coverage bars"
          className="mt-1 flex h-6 w-full cursor-pointer items-end justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <ChevronUp aria-hidden="true" className="size-4 text-muted-foreground" />
        </button>
      )}
    </div>
  )
}

function CardCoverageBlock({ coverage }: { coverage: CardCoverage }) {
  const vocabularyIndex = useVocabularyIndex()
  const sourceLabel = (name: string) => termLabel(vocabularyIndex, 'sources', name)
  const items = [
    ...coverage.covers.map(({ coveredSource, capped }) => ({
      key: `covers:${coveredSource}`,
      node: <CompactCappedBar title={`Supports ${sourceLabel(coveredSource)}`} capped={capped} />,
    })),
    ...coverage.coveredBy.map(({ coveringSource, capped }) => ({
      key: `covered-by:${coveringSource}`,
      node: <CompactCappedBar title={`Supported by ${sourceLabel(coveringSource)}`} capped={capped} />,
    })),
    ...coverage.related.map(({ otherSource, coverage: relatedCoverage }) => ({
      key: `related:${otherSource}`,
      node: (
        <div className="space-y-0.5">
          <p className="flex flex-wrap justify-between gap-x-3 text-xs">
            <span className="font-medium">Related to {sourceLabel(otherSource)}</span>
            <span className="text-muted-foreground">{formatCount(relatedCoverage.relatedOnly)} related only</span>
          </p>
          <CoverageBar
            covered={0}
            coveredThroughSupporting={0}
            relatedOnly={relatedCoverage.relatedOnly}
            total={relatedCoverage.total}
            label={`Related to ${sourceLabel(otherSource)}: ${formatCount(relatedCoverage.relatedOnly)} of ${formatCount(relatedCoverage.total)} related only, not counted as coverage`}
          />
          <p className="text-xs text-muted-foreground">{RELATED_NOT_COVERAGE_NOTE}</p>
        </div>
      ),
    })),
  ]
  return (
    <div data-testid="card-coverage" className="space-y-4 border-t border-border pt-3">
      <CappedCoverageList items={items} />
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

function FrameworkCard({ source, coverage }: { source: ManifestSource; coverage: CardCoverage | undefined }) {
  const showComparison = useFilterStore((state) => state.showComparison)
  const current = source.releases[source.releases.length - 1]
  const releaseTags = source.releases.map((release) => release.tag)
  const hasPairs = hasCoverageBlock(coverage)
  const { older, visible } = splitReleases(source.releases)
  const releaseLinkProps = (release: ManifestSource['releases'][number]) => {
    const range = { fromTag: previousReleaseTag(releaseTags, release.tag)!, toTag: release.tag }
    return {
      href: comparisonLocation(source.name, range, import.meta.env.BASE_URL),
      'aria-label': accessibleName(release.label, release.tag === current.tag, release.tag === releaseTags[0]),
      onClick: (event: MouseEvent<HTMLElement>) => {
        if (!isPlainLeftClick(event)) return
        event.preventDefault()
        showComparison(source.name, range.fromTag, range.toTag)
      },
    }
  }
  return (
    <li data-testid="framework-card" className="space-y-3 rounded-lg border border-border bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {/* The 16rem basis lets the source line wrap its licence badge before it pushes the
            Rules/Coverage links out of the title row; below that width the links wrap instead. */}
        <div className="min-w-0 flex-[1_1_16rem] space-y-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-base font-semibold">{source.display_name}</h2>
            <ProvenanceBadge provenance={source.provenance} />
          </div>
          <SourceLine source={source} />
        </div>
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
      </div>
      <p className="text-sm text-muted-foreground">
        Current: {current.label} ({current.tag}) · {pluralize(source.rule_count, 'rule', 'rules')}
      </p>
      <p className="text-sm text-muted-foreground">Choose a release to see what changed in it.</p>
      <ul aria-label="Releases" className="flex flex-wrap gap-2">
        {older.length > 0 && (
          <li>
            <Menu>
              <MenuTrigger className={buttonVariants({ variant: 'outline', size: 'xs' })}>
                Older releases
                <ChevronDown aria-hidden="true" />
              </MenuTrigger>
              <MenuContent>
                {older.map((release) => (
                  <MenuLinkItem key={release.tag} {...releaseLinkProps(release)}>
                    {release.label}
                  </MenuLinkItem>
                ))}
              </MenuContent>
            </Menu>
          </li>
        )}
        {visible.map((release) => (
          <li key={release.tag}>
            <a
              {...releaseLinkProps(release)}
              className={buttonVariants({ variant: release.tag === current.tag ? 'default' : 'outline', size: 'xs' })}
            >
              {release.label}
              {release.tag === current.tag && ' · current'}
            </a>
          </li>
        ))}
      </ul>
      {hasCoverageBlock(coverage) && <CardCoverageBlock coverage={coverage} />}
    </li>
  )
}

function CardGrid({ sources, coverageBySource }: { sources: ManifestSource[]; coverageBySource: ReadonlyMap<string, CardCoverage> }) {
  return (
    <ul className="grid gap-4 p-4 md:grid-cols-2">
      {sources.map((source) => (
        <FrameworkCard key={source.name} source={source} coverage={coverageBySource.get(source.name)} />
      ))}
    </ul>
  )
}

// The home grid: a way into every rule, then one card per framework with what is current, a
// compact coverage summary, and every release kept, each one the way into what changed in it.
export function FrameworkCards({ sources, coverageBySource }: { sources: ManifestSource[]; coverageBySource: ReadonlyMap<string, CardCoverage> }) {
  const { official, community } = groupByProvenance(sources)
  return (
    <div>
      <div className="px-4 pt-4">
        <FrameworkPageLink framework={ALL_FRAMEWORKS} tab="rules" variant="link">
          Browse all rules
        </FrameworkPageLink>
      </div>
      <CardGrid sources={official} coverageBySource={coverageBySource} />
      {community.length > 0 && (
        <section aria-labelledby="community-frameworks-heading">
          <h2 id="community-frameworks-heading" className="mx-4 mt-2 border-t border-border pt-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Community
          </h2>
          <CardGrid sources={community} coverageBySource={coverageBySource} />
        </section>
      )}
    </div>
  )
}
