import { ArrowUpRight } from 'lucide-react'
import { useId, useMemo, useState, type MouseEvent } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCustomisedRuleIds } from '../../hooks/useCustomisedRuleIds'
import { useHistoryIndex } from '../../hooks/useHistoryIndex'
import { comparisonFacetCounts, filterComparison, type ComparisonFilters } from '../../logic/comparisonFilters'
import { compareReleases, latestReleaseWithRule, ruleFilePathAtRelease, type HistoryIndex, type RuleComparison } from '../../logic/historyIndex'
import { DEFAULT_SHOWN_KINDS, type ChangeKind } from '../../logic/ruleChanges'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { useFilterStore } from '../../state/filterStore'
import { DEFAULT_AUTOMATION, DEFAULT_PAGE_SIZE, DEFAULT_VIEW_ID, parseUrlState, serializeUrlLocation } from '../../state/urlState'
import type { ManifestSource } from '../../types/library'
import { ChangesBetween } from '../history/ChangesBetween'
import { KindTag } from '../history/KindTag'
import { RuleDetailPanel } from '../rules/RuleDetailPanel'
import { ComparisonSidebar } from './ComparisonSidebar'

type Group = 'added' | 'removed' | 'changed'

const GROUP_TITLES: Record<Group, string> = { added: 'Added', removed: 'Removed', changed: 'Changed' }
const ROWS_PER_STEP = 50

// The range the address names when it names a valid one, otherwise the
// previous release to the current one.
function resolvedRange(history: HistoryIndex, from: string | null, to: string | null): { fromTag: string; toTag: string } {
  const tags = history.releases.map((release) => release.tag)
  const fromPosition = from === null ? -1 : tags.indexOf(from)
  const toPosition = to === null ? -1 : tags.indexOf(to)
  if (fromPosition !== -1 && toPosition > fromPosition) return { fromTag: tags[fromPosition], toTag: tags[toPosition] }
  return { fromTag: tags[tags.length - 2], toTag: tags[tags.length - 1] }
}

function hrefShowing(ruleId: string): string {
  const state = { ...parseUrlState(''), view: DEFAULT_VIEW_ID, search: upstreamRuleId(ruleId), openRule: ruleId }
  return serializeUrlLocation(state, { automation: DEFAULT_AUTOMATION, size: DEFAULT_PAGE_SIZE }, import.meta.env.BASE_URL)
}

function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function SummaryTile({ name, label, value }: { name: string; label: string; value: number }) {
  return (
    <div data-testid={`summary-tile-${name}`} className="rounded-lg border border-border bg-panel px-3 py-2">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function RuleLinks({ ruleId }: { ruleId: string }) {
  const showRuleFromComparison = useFilterStore((state) => state.showRuleFromComparison)
  function open(tab: 'history' | null) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isPlainClick(event)) return
      event.preventDefault()
      showRuleFromComparison(ruleId, upstreamRuleId(ruleId), tab)
    }
  }
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <a href={hrefShowing(ruleId)} onClick={open(null)} className={buttonVariants({ variant: 'outline', size: 'xs' })}>
        Open rule
        <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
      </a>
      <a href={hrefShowing(ruleId)} onClick={open('history')} className={buttonVariants({ variant: 'outline', size: 'xs' })}>
        Full history
        <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
      </a>
    </div>
  )
}

function ComparisonRow({
  entry,
  group,
  history,
  fromTag,
  toTag,
  kinds,
  isOpen,
  onToggle,
}: {
  entry: RuleComparison
  group: Group
  history: HistoryIndex
  fromTag: string
  toTag: string
  kinds: ReadonlySet<ChangeKind>
  isOpen: boolean
  onToggle: () => void
}) {
  const bodyId = useId()
  // An added or removed rule is shown as the newest release that has it stored it.
  const storedAt = latestReleaseWithRule(history, entry.id)
  const storedPath = storedAt === null ? null : ruleFilePathAtRelease(history, entry.id, storedAt.tag)
  return (
    <li data-testid="comparison-row" data-group={group} className="border-b border-border last:border-b-0">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={isOpen ? bodyId : undefined}
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
      >
        <span className={group === 'removed' ? 'min-w-0 break-words line-through' : 'min-w-0 break-words'}>{entry.title}</span>
        <span className="font-mono text-xs text-muted-foreground">{upstreamRuleId(entry.id)}</span>
        {entry.kinds.map((kind) => (
          <KindTag key={kind} kind={kind} />
        ))}
      </button>
      {isOpen && (
        <div id={bodyId} className="border-t border-border px-4 py-2">
          {group === 'changed' && (
            <>
              <ChangesBetween index={history} ruleId={entry.id} fromTag={fromTag} toTag={toTag} kinds={kinds} />
              <RuleLinks ruleId={entry.id} />
            </>
          )}
          {group !== 'changed' && storedPath !== null && (
            <div className="overflow-hidden rounded-md border border-border">
              <RuleDetailPanel ruleRef={{ id: entry.id, path: storedPath }} nested />
            </div>
          )}
          {group === 'added' && <RuleLinks ruleId={entry.id} />}
        </div>
      )}
    </li>
  )
}

function GroupSection({
  group,
  entries,
  history,
  fromTag,
  toTag,
  kinds,
  openKeys,
  onToggle,
  visibleCount,
  onShowMore,
}: {
  group: Group
  entries: RuleComparison[]
  history: HistoryIndex
  fromTag: string
  toTag: string
  kinds: ReadonlySet<ChangeKind>
  openKeys: ReadonlySet<string>
  onToggle: (key: string) => void
  visibleCount: number
  onShowMore: () => void
}) {
  if (entries.length === 0) return null
  return (
    <section aria-label={GROUP_TITLES[group]} className="border-b border-border">
      <h2 className="bg-section-2 px-4 py-2 text-sm font-semibold text-section-foreground">
        {GROUP_TITLES[group]} ({entries.length})
      </h2>
      <ul>
        {entries.slice(0, visibleCount).map((entry) => (
          <ComparisonRow
            key={entry.id}
            entry={entry}
            group={group}
            history={history}
            fromTag={fromTag}
            toTag={toTag}
            kinds={kinds}
            isOpen={openKeys.has(`${group}:${entry.id}`)}
            onToggle={() => onToggle(`${group}:${entry.id}`)}
          />
        ))}
      </ul>
      {entries.length > visibleCount && (
        <div className="px-4 py-2">
          <button type="button" onClick={onShowMore} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Show {Math.min(ROWS_PER_STEP, entries.length - visibleCount)} more ({entries.length - visibleCount} left)
          </button>
        </div>
      )}
    </section>
  )
}

function Message({ children }: { children: string }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>
}

export function ReleaseComparisonView({
  sources,
  source,
  enabledRuleIds,
  filtersOpen,
}: {
  sources: ManifestSource[]
  source: ManifestSource
  enabledRuleIds: ReadonlySet<string>
  filtersOpen: boolean
}) {
  const state = useHistoryIndex(source.name)
  const compareFrom = useFilterStore((store) => store.compareFrom)
  const compareTo = useFilterStore((store) => store.compareTo)
  const changeKinds = useFilterStore((store) => store.changeKinds)
  const search = useFilterStore((store) => store.compareSearch)
  const sections = useFilterStore((store) => store.compareSections)
  const benchmarks = useFilterStore((store) => store.compareBenchmarks)
  const only = useFilterStore((store) => store.compareOnly)
  const setSearch = useFilterStore((store) => store.setCompareSearch)
  const closeComparison = useFilterStore((store) => store.closeComparison)
  const customisedRuleIds = useCustomisedRuleIds()
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(new Set())
  const [visibleCounts, setVisibleCounts] = useState<Record<Group, number>>({ added: ROWS_PER_STEP, removed: ROWS_PER_STEP, changed: ROWS_PER_STEP })

  const history = state.status === 'ready' ? state.index : null
  const range = history === null ? null : resolvedRange(history, compareFrom, compareTo)
  const kinds = useMemo<ReadonlySet<ChangeKind>>(() => new Set(changeKinds ?? DEFAULT_SHOWN_KINDS), [changeKinds])
  const onlyRuleIds = useMemo<ReadonlySet<string> | null>(() => {
    if (only.length === 0) return null
    const wanted = only.map((choice) => (choice === 'custom' ? (customisedRuleIds ?? new Set<string>()) : enabledRuleIds))
    return new Set([...wanted[0]].filter((ruleId) => wanted.every((ruleIds) => ruleIds.has(ruleId))))
  }, [only, customisedRuleIds, enabledRuleIds])
  const filters = useMemo<ComparisonFilters>(() => ({ kinds, search, sections, benchmarks, onlyRuleIds }), [kinds, search, sections, benchmarks, onlyRuleIds])
  const rangeFromTag = range === null ? null : range.fromTag
  const rangeToTag = range === null ? null : range.toTag
  const comparison = useMemo(
    () => (history === null || rangeFromTag === null || rangeToTag === null ? null : compareReleases(history, rangeFromTag, rangeToTag)),
    [history, rangeFromTag, rangeToTag],
  )
  const filtered = useMemo(() => (comparison === null ? null : filterComparison(comparison, filters)), [comparison, filters])
  const counts = useMemo(() => (comparison === null ? null : comparisonFacetCounts(comparison, filters)), [comparison, filters])

  if (state.status === 'loading') return <main className="flex-1 overflow-y-auto"><Message>Loading the release history…</Message></main>
  if (state.status === 'error') return <main className="flex-1 overflow-y-auto"><Message>{`The release history could not be loaded: ${state.message}`}</Message></main>
  if (history === null || range === null || comparison === null || filtered === null || counts === null) return null

  const fromLabel = history.releases.find((release) => release.tag === range.fromTag)?.label ?? range.fromTag
  const toLabel = history.releases.find((release) => release.tag === range.toTag)?.label ?? range.toTag
  const groups: [Group, RuleComparison[]][] = [
    ['added', filtered.added],
    ['removed', filtered.removed],
    ['changed', filtered.changed],
  ]
  const shownKeys = groups.flatMap(([group, entries]) => entries.slice(0, visibleCounts[group]).map((entry) => `${group}:${entry.id}`))
  const hasRows = groups.some(([, entries]) => entries.length > 0)

  function toggleRow(key: string) {
    setOpenKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
      <div id="filter-sidebar" className={`shrink-0 ${filtersOpen ? 'block' : 'hidden'} md:flex`}>
        <ComparisonSidebar
          sources={sources}
          source={source}
          history={history}
          fromTag={range.fromTag}
          toTag={range.toTag}
          kinds={kinds}
          counts={counts}
          sections={sections}
          benchmarks={benchmarks}
          only={only}
        />
      </div>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="space-y-3 p-4">
          <div>
            <button type="button" onClick={closeComparison} className="text-sm text-link underline">
              All frameworks
            </button>
            <h2 className="text-lg font-semibold">
              {source.display_name}: {fromLabel} to {toLabel}
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <SummaryTile name="added" label="added" value={filtered.added.length} />
            <SummaryTile name="removed" label="removed" value={filtered.removed.length} />
            <SummaryTile name="changed" label="changed" value={filtered.changed.length} />
            <SummaryTile name="unchanged" label="unchanged (hidden)" value={comparison.unchangedCount} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              aria-label="Search title or id"
              placeholder="Search title or id…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="max-w-sm"
            />
            <button type="button" onClick={() => setOpenKeys(new Set(shownKeys))} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Expand all
            </button>
            <button type="button" onClick={() => setOpenKeys(new Set())} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Collapse all
            </button>
          </div>
        </div>
        {hasRows ? (
          groups.map(([group, entries]) => (
            <GroupSection
              key={group}
              group={group}
              entries={entries}
              history={history}
              fromTag={range.fromTag}
              toTag={range.toTag}
              kinds={kinds}
              openKeys={openKeys}
              onToggle={toggleRow}
              visibleCount={visibleCounts[group]}
              onShowMore={() => setVisibleCounts((current) => ({ ...current, [group]: current[group] + ROWS_PER_STEP }))}
            />
          ))
        ) : (
          <Message>No rules match these filters.</Message>
        )}
      </main>
    </div>
  )
}
