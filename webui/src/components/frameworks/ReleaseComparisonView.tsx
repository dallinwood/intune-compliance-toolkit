import { ArrowUpRight } from 'lucide-react'
import { useId, useMemo, useState, type MouseEvent } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useExpandedGroups } from '../../hooks/useExpandedGroups'
import { useCustomisedRuleIds } from '../../hooks/useCustomisedRuleIds'
import { useHistoryIndex } from '../../hooks/useHistoryIndex'
import { comparisonFacetCounts, filterComparison, type ComparisonFilters } from '../../logic/comparisonFilters'
import { compareReleases, latestReleaseWithRule, ruleFilePathAtRelease, type HistoryIndex, type RuleComparison } from '../../logic/historyIndex'
import { effectiveKinds, type ChangeKind } from '../../logic/ruleChanges'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { useFilterStore } from '../../state/filterStore'
import { DEFAULT_AUTOMATION, DEFAULT_PAGE_SIZE, DEFAULT_VIEW_ID, parseUrlState, serializeUrlLocation, type CompareGroup } from '../../state/urlState'
import type { ManifestSource } from '../../types/library'
import { ChangesBetween } from '../history/ChangesBetween'
import { KindTag } from '../history/KindTag'
import { RuleDetailPanel } from '../rules/RuleDetailPanel'
import { SectionHeader } from '../rules/SectionHeader'
import { SectionToolbar } from '../rules/SectionToolbar'
import { ComparisonSidebar } from './ComparisonSidebar'

type Group = CompareGroup

const GROUP_TITLES: Record<Group, string> = { added: 'Added', removed: 'Removed', changed: 'Changed', unchanged: 'Unchanged' }
// The groups listed when no tile has narrowed the comparison; unchanged rules are only listed on request.
const DEFAULT_GROUPS: readonly Group[] = ['added', 'removed', 'changed']
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

const groupKey = (group: Group) => `group:${group}`
const rowKey = (group: Group, ruleId: string) => `${group}:${ruleId}`

function hrefShowing(ruleId: string): string {
  const state = { ...parseUrlState(''), view: DEFAULT_VIEW_ID, search: upstreamRuleId(ruleId), openRule: ruleId }
  return serializeUrlLocation(state, { automation: DEFAULT_AUTOMATION, size: DEFAULT_PAGE_SIZE }, import.meta.env.BASE_URL)
}

function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

// A summary tile is also a filter: pressed, it narrows the comparison to its group.
function SummaryTile({ group, label, value, isSelected, onSelect }: { group: Group; label: string; value: number; isSelected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      data-testid={`summary-tile-${group}`}
      aria-pressed={isSelected}
      onClick={onSelect}
      className={cn(
        'rounded-lg border border-border bg-panel px-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none',
        'hover:bg-muted aria-pressed:border-foreground/60 aria-pressed:bg-muted',
      )}
    >
      <span className="block text-2xl font-semibold tabular-nums">{value}</span>
      <span className="block text-xs text-muted-foreground">{label}</span>
    </button>
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
  // An unchanged rule is shown as the To release stored it; an added or
  // removed one as the newest release that has it stored it.
  const storedAt = group === 'unchanged' ? { tag: toTag } : latestReleaseWithRule(history, entry.id)
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
          {(group === 'added' || group === 'unchanged') && <RuleLinks ruleId={entry.id} />}
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
  isGroupOpen,
  onToggleGroup,
  openRowKeys,
  onToggleRow,
  visibleCount,
  onShowMore,
}: {
  group: Group
  entries: RuleComparison[]
  history: HistoryIndex
  fromTag: string
  toTag: string
  kinds: ReadonlySet<ChangeKind>
  isGroupOpen: boolean
  onToggleGroup: (key: string) => void
  openRowKeys: (key: string) => boolean
  onToggleRow: (key: string) => void
  visibleCount: number
  onShowMore: () => void
}) {
  if (entries.length === 0) return null
  return (
    <section aria-label={GROUP_TITLES[group]} className="border-b border-border">
      <SectionHeader id={groupKey(group)} label={GROUP_TITLES[group]} count={entries.length} depth={1} isOpen={isGroupOpen} onToggle={onToggleGroup} />
      {isGroupOpen && (
        <>
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
                isOpen={openRowKeys(rowKey(group, entry.id))}
                onToggle={() => onToggleRow(rowKey(group, entry.id))}
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
        </>
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
  const compareGroup = useFilterStore((store) => store.compareGroup)
  const setCompareGroup = useFilterStore((store) => store.setCompareGroup)
  const customised = useCustomisedRuleIds()
  const customisedUnavailable = customised.status === 'unavailable'
  // Groups start open; rows start closed.
  const groupsOpen = useExpandedGroups(['added', 'removed', 'changed', 'unchanged'].map((group) => groupKey(group as Group)))
  const rowsOpen = useExpandedGroups([])
  const [visibleCounts, setVisibleCounts] = useState<Record<Group, number>>({ added: ROWS_PER_STEP, removed: ROWS_PER_STEP, changed: ROWS_PER_STEP, unchanged: ROWS_PER_STEP })

  // "Show more" starts over whenever the list it extends is a different one.
  const listKey = JSON.stringify([source.name, compareFrom, compareTo, compareGroup, changeKinds, search, sections, benchmarks, only])
  const [shownForKey, setShownForKey] = useState(listKey)
  if (shownForKey !== listKey) {
    setShownForKey(listKey)
    setVisibleCounts({ added: ROWS_PER_STEP, removed: ROWS_PER_STEP, changed: ROWS_PER_STEP, unchanged: ROWS_PER_STEP })
  }

  const history = state.status === 'ready' ? state.index : null
  const range = history === null ? null : resolvedRange(history, compareFrom, compareTo)
  const kinds = useMemo<ReadonlySet<ChangeKind>>(() => effectiveKinds(changeKinds ?? []), [changeKinds])
  const onlyRuleIds = useMemo<ReadonlySet<string> | null>(() => {
    // An unavailable custom-changes list cannot narrow anything, so that choice is left out.
    const choices = only.filter((choice) => choice !== 'custom' || !customisedUnavailable)
    if (choices.length === 0) return null
    const wanted = choices.map((choice) => (choice === 'custom' ? (customised.status === 'ready' ? customised.ruleIds : new Set<string>()) : enabledRuleIds))
    return new Set([...wanted[0]].filter((ruleId) => wanted.every((ruleIds) => ruleIds.has(ruleId))))
  }, [only, customised, customisedUnavailable, enabledRuleIds])
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
  const shownGroups = compareGroup === null ? DEFAULT_GROUPS : [compareGroup]
  const groups: [Group, RuleComparison[]][] = shownGroups.map((group) => [group, filtered[group]])
  const shownGroupKeys = groups.filter(([, entries]) => entries.length > 0).map(([group]) => groupKey(group))
  const hasRows = groups.some(([, entries]) => entries.length > 0)

  function selectTile(group: Group) {
    setCompareGroup(compareGroup === group ? null : group)
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
          selectedKinds={changeKinds}
          customisedUnavailable={customisedUnavailable}
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
            {(
              [
                ['added', 'added', filtered.added.length],
                ['removed', 'removed', filtered.removed.length],
                ['changed', 'changed', filtered.changed.length],
                ['unchanged', 'unchanged', filtered.unchanged.length],
              ] as const
            ).map(([group, label, value]) => (
              <SummaryTile key={group} group={group} label={label} value={value} isSelected={compareGroup === group} onSelect={() => selectTile(group)} />
            ))}
          </div>
          <Input
            type="search"
            aria-label="Search title or id"
            placeholder="Search title or id…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="max-w-sm"
          />
        </div>
        {/* As on the Rules tab, the toolbar opens and closes the section headers only; a row opens by click. */}
        <SectionToolbar
          onExpandOneLevel={() => groupsOpen.expand(shownGroupKeys)}
          onCollapseOneLevel={() => groupsOpen.collapse(shownGroupKeys)}
          onExpandAll={() => groupsOpen.expand(shownGroupKeys)}
          onCollapseAll={() => groupsOpen.collapse(shownGroupKeys)}
        />
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
              isGroupOpen={groupsOpen.isExpanded(groupKey(group))}
              onToggleGroup={groupsOpen.toggle}
              openRowKeys={rowsOpen.isExpanded}
              onToggleRow={rowsOpen.toggle}
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
