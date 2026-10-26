import { ChevronRight, Loader2, Settings2 } from 'lucide-react'
import { Fragment, memo, useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useRule, useUsableOdvValue } from '@/hooks/useRule'
import { NO_VERSION_KEY } from '../../logic/applicability'
import { displayWithOdv } from '../../logic/odv'
import { assessmentLabel, benchmarkSummary, upstreamRuleId } from '../../logic/ruleDisplay'
import { sectionGroupKey, versionsUnder } from '../../logic/ruleFilters'
import {
  allNodeIds,
  buildSectionTree,
  clampPage,
  collapseOneLevel,
  expandOneLevel,
  paginate,
  revealRules,
  searchExpanded,
  visibleItems,
  type SectionNode,
  type VisibleItem,
} from '../../logic/sectionTree'
import { isEnabled, refKey } from '../../logic/selectionEntry'
import { compareGroupKeys, groupLabel } from '../../logic/vocabulary'
import { useFilterStore } from '../../state/filterStore'
import { useSectionStore } from '../../state/sectionStore'
import { useSelectionStore } from '../../state/selectionStore'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { RuleRow } from '../../types/rule-row'
import { PagingBar } from './PagingBar'
import { RuleDetailPanel } from './RuleDetailPanel'
import { SectionToolbar } from './SectionToolbar'

const INFINITE_SCROLL_STEP = 100

interface SearchExpansion {
  tree: SectionNode[]
  expanded: ReadonlySet<string>
}

interface RevealedRules {
  items: VisibleItem[]
  ruleLimit: number
}

export function RuleTable({ rows, isStale, search }: { rows: RuleRow[]; isStale: boolean; search: string }) {
  const index = useVocabularyIndex()
  const tree = useMemo(
    () =>
      buildSectionTree(rows, (groupKey) => groupLabel(index, 'sections', groupKey), {
        rootKeyOf: (row) => sectionGroupKey(row, index),
        compareRoots: compareGroupKeys(index, 'sections'),
      }),
    [rows, index],
  )

  // While a search is active every section holding a match is open, and the
  // section controls act on that search view only; clearing the search goes
  // back to the stored state. A new search result starts fully open again.
  const isSearching = search.trim() !== ''
  const storedExpanded = useSectionStore((store) => store.expanded)
  const setStoredExpanded = useSectionStore((store) => store.setExpanded)
  const [searchExpansion, setSearchExpansion] = useState<SearchExpansion | null>(null)
  const expandedForSearch = useMemo(() => (isSearching ? searchExpanded(tree) : null), [isSearching, tree])
  const expanded: ReadonlySet<string> = expandedForSearch
    ? searchExpansion?.tree === tree
      ? searchExpansion.expanded
      : expandedForSearch
    : storedExpanded

  const size = useFilterStore((store) => store.size)
  const storedPage = useFilterStore((store) => store.page)
  const setPage = useFilterStore((store) => store.setPage)
  const setSize = useFilterStore((store) => store.setSize)

  // A collapse that leaves fewer pages than the stored page moves the stored
  // page (and the URL) back into range, so reopening a section starts at its
  // top. Expanding never moves it: a shared page=3 still lands on page 3 once
  // its sections are open.
  const setExpanded = useCallback(
    (next: ReadonlySet<string>, isCollapse: boolean) => {
      if (isSearching) setSearchExpansion({ tree, expanded: next })
      else setStoredExpanded(next)
      if (!isCollapse || size === 'all') return
      const nextPageCount = paginate(visibleItems(tree, next), size).length
      if (storedPage > nextPageCount) setPage(clampPage(storedPage, nextPageCount))
    },
    [isSearching, tree, setStoredExpanded, size, storedPage, setPage],
  )
  const toggleSection = useCallback(
    (sectionId: string) => {
      const next = new Set(expanded)
      const isCollapse = next.has(sectionId)
      if (isCollapse) next.delete(sectionId)
      else next.add(sectionId)
      setExpanded(next, isCollapse)
    },
    [expanded, setExpanded],
  )

  // Section actions render from a deferred copy, like filter changes:
  // expanding every section is a large render, and the zustand store updates
  // synchronously, so startTransition alone would not defer it.
  const deferredExpanded = useDeferredValue(expanded)
  const isCatchingUp = isStale || deferredExpanded !== expanded
  const items = useMemo(() => visibleItems(tree, deferredExpanded), [tree, deferredExpanded])
  const pages = useMemo(() => (size === 'all' ? null : paginate(items, size)), [items, size])
  // Also clamped for display: a stored page past the end shows the last page.
  const currentPage = pages ? clampPage(storedPage, pages.length) : 1

  // Any change to what is visible (filters or sections) starts infinite
  // scroll again from the first batch.
  const [revealedRules, setRevealedRules] = useState<RevealedRules>({ items, ruleLimit: INFINITE_SCROLL_STEP })
  const ruleLimit = revealedRules.items === items ? revealedRules.ruleLimit : INFINITE_SCROLL_STEP
  const revealed = useMemo(() => (size === 'all' ? revealRules(items, ruleLimit) : null), [items, size, ruleLimit])
  const revealMore = useCallback(() => setRevealedRules({ items, ruleLimit: ruleLimit + INFINITE_SCROLL_STEP }), [items, ruleLimit])

  const shownItems = pages ? pages[currentPage - 1].items : (revealed?.items ?? [])

  const [expandedRules, setExpandedRules] = useState<ReadonlySet<string>>(new Set())
  const toggleRule = useCallback((ruleKey: string) => {
    setExpandedRules((current) => {
      const next = new Set(current)
      if (next.has(ruleKey)) next.delete(ruleKey)
      else next.add(ruleKey)
      return next
    })
  }, [])

  const tableTopRef = useRef<HTMLDivElement>(null)
  function changePage(page: number) {
    setPage(page)
    tableTopRef.current?.scrollIntoView({ block: 'start' })
  }

  return (
    <div ref={tableTopRef} data-testid="rule-table">
      <SectionToolbar
        onExpandOneLevel={() => setExpanded(expandOneLevel(tree, expanded), false)}
        onCollapseOneLevel={() => setExpanded(collapseOneLevel(tree, expanded), true)}
        onExpandAll={() => setExpanded(allNodeIds(tree), false)}
        onCollapseAll={() => setExpanded(new Set(), true)}
      />
      <div className="relative">
        <div className={isCatchingUp ? 'pointer-events-none opacity-50' : undefined}>
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-slate-500 dark:text-muted-foreground">No rules match the current filters.</p>
          ) : (
            <>
              <TooltipProvider>
                <RuleItems
                  items={shownItems}
                  expanded={deferredExpanded}
                  expandedRules={expandedRules}
                  onToggleSection={toggleSection}
                  onToggleRule={toggleRule}
                />
              </TooltipProvider>
              {revealed?.hasMore && <InfiniteScrollSentinel onReveal={revealMore} />}
              <PagingBar
                currentPage={currentPage}
                pageCount={pages?.length ?? 1}
                size={size}
                onPageChange={changePage}
                onSizeChange={setSize}
              />
            </>
          )}
        </div>
        {isCatchingUp && (
          <div role="status" aria-label="Updating rules" className="pointer-events-none absolute inset-0">
            <div className="sticky top-1/3 flex justify-center">
              <Loader2 className="size-8 animate-spin text-indigo-500 dark:text-indigo-400" aria-hidden="true" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Re-subscribes on every reveal (onReveal changes identity), so a sentinel
// still in view after the new rows render triggers the next batch at once.
function InfiniteScrollSentinel({ onReveal }: { onReveal: () => void }) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    // The margin starts loading the next batch before the end comes into view.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onReveal()
      },
      { rootMargin: '600px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [onReveal])
  return <div ref={sentinelRef} data-testid="infinite-scroll-sentinel" className="h-px" />
}

type RenderBlock = { kind: 'section'; node: SectionNode } | { kind: 'rules'; key: string; depth: number; rows: RuleRow[] }

// Consecutive rule items share one <table>; each header sits between tables.
function blocksOf(items: VisibleItem[]): RenderBlock[] {
  const blocks: RenderBlock[] = []
  for (const item of items) {
    if (item.kind === 'section') {
      blocks.push({ kind: 'section', node: item.node })
      continue
    }
    const lastBlock = blocks.at(-1)
    if (lastBlock?.kind === 'rules') lastBlock.rows.push(item.row)
    else blocks.push({ kind: 'rules', key: refKey(item.row.ref), depth: item.depth, rows: [item.row] })
  }
  return blocks
}

interface RuleItemsProps {
  items: VisibleItem[]
  expanded: ReadonlySet<string>
  expandedRules: ReadonlySet<string>
  onToggleSection: (sectionId: string) => void
  onToggleRule: (ruleKey: string) => void
}

// Memoized so flipping the stale overlay on (an urgent render) re-renders only
// RuleTable's wrapper, not every row.
const RuleItems = memo(function RuleItems({ items, expanded, expandedRules, onToggleSection, onToggleRule }: RuleItemsProps) {
  const blocks = useMemo(() => blocksOf(items), [items])
  return (
    <div>
      {blocks.map((block) =>
        block.kind === 'section' ? (
          <SectionHeader key={block.node.id} node={block.node} isOpen={expanded.has(block.node.id)} onToggle={onToggleSection} />
        ) : (
          <RuleRowsTable key={block.key} depth={block.depth} rows={block.rows} expandedRules={expandedRules} onToggleRule={onToggleRule} />
        ),
      )}
    </div>
  )
})

// Tailwind only sees literal class names, so each level's classes are spelled out.
const SECTION_LEVEL_STYLES: Record<number, string> = {
  1: 'bg-slate-100 dark:bg-muted font-semibold',
  2: 'bg-slate-50 dark:bg-card font-medium',
  3: 'bg-background font-medium',
}
const SECTION_LEVEL_INDENTS: Record<number, string> = { 1: 'pl-4', 2: 'pl-8', 3: 'pl-12' }
const HEADING_TAGS = { 1: 'h2', 2: 'h3', 3: 'h4' } as const

function SectionHeader({ node, isOpen, onToggle }: { node: SectionNode; isOpen: boolean; onToggle: (sectionId: string) => void }) {
  const level = Math.min(node.depth, 3) as 1 | 2 | 3
  const HeadingTag = HEADING_TAGS[level]
  return (
    <HeadingTag className={`border-b border-slate-200 dark:border-border text-sm text-slate-700 dark:text-zinc-200 ${SECTION_LEVEL_STYLES[level]}`}>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => onToggle(node.id)}
        className={`flex w-full items-center gap-1.5 py-2 pr-4 text-left hover:bg-slate-200/60 dark:hover:bg-zinc-700/60 ${SECTION_LEVEL_INDENTS[level]}`}
      >
        <ChevronRight className={`size-4 shrink-0 text-slate-400 dark:text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden="true" />
        <span>
          {node.label} <span className="font-normal text-slate-400 dark:text-muted-foreground">({node.ruleCount})</span>
        </span>
      </button>
    </HeadingTag>
  )
}

// Matches the headers' pl-4 per level, on md and up only so phones keep the
// title column wide.
const RULE_TITLE_INDENTS: Record<number, string> = { 1: '', 2: 'md:pl-6', 3: 'md:pl-10' }

interface RuleRowsTableProps {
  depth: number
  rows: RuleRow[]
  expandedRules: ReadonlySet<string>
  onToggleRule: (ruleKey: string) => void
}

function RuleRowsTable({ depth, rows, expandedRules, onToggleRule }: RuleRowsTableProps) {
  const titleIndent = RULE_TITLE_INDENTS[Math.min(depth, 3)]
  const selections = useSelectionStore((store) => store.selections)
  const setEnabled = useSelectionStore((store) => store.setEnabled)

  return (
    // table-fixed is load-bearing, not cosmetic: every run of rules between
    // two section headers is its own <table>, so under the default auto
    // layout each one (and every expand/collapse, since a colSpan detail row
    // also perturbs the calculation) would compute its own column widths from
    // its own content, making the title column's start drift between runs.
    // Fixed columns: checkbox 48 + chevron 32 + assessment 176 + benchmarks
    // 224 = 480px, and min-w leaves the flexible title column room instead of
    // squeezing it. Below md the assessment and benchmark columns fold under
    // the title so phones never scroll sideways.
    <table className="w-full table-fixed text-sm md:min-w-[780px]">
      {/* Explicit column widths: a fixed layout otherwise takes them from
          the first row, where the two md-only cells are hidden on phones,
          so an expanded row's colSpan detail cell would add two auto-width
          columns that squeeze the title. */}
      <colgroup>
        <col className="w-12" />
        <col className="w-8" />
        <col />
        <col className="w-0 md:w-44" />
        <col className="w-0 md:w-56" />
      </colgroup>
      <tbody>
        {rows.map((row) => {
          const key = refKey(row.ref)
          const isExpanded = expandedRules.has(key)
          const detailId = `rule-detail-${key}`
          // Always-reserved, normally-transparent left border (rather
          // than one that appears/disappears) so toggling expand never
          // shifts the row's contents.
          const expandedAccent = isExpanded ? 'border-indigo-500 dark:border-indigo-400 bg-indigo-50 dark:bg-indigo-950/50' : 'border-transparent'
          return (
            <Fragment key={key}>
              <tr
                className={`cursor-pointer border-l-4 align-top ${expandedAccent} ${isExpanded ? 'hover:bg-indigo-100 dark:hover:bg-indigo-950' : 'hover:bg-slate-50 dark:hover:bg-muted/60'}`}
                onClick={(event) => {
                  // Let the checkbox (or any other control in the row)
                  // handle its own click instead of also toggling expand.
                  // Base UI's Checkbox renders role="checkbox", not a real
                  // <input>, so it needs its own selector here.
                  if ((event.target as HTMLElement).closest('input, a, button, [data-slot="checkbox"]')) return
                  onToggleRule(key)
                }}
              >
                <td className="w-12 py-2 pl-4 md:pl-6">
                  <RowCheckbox
                    ruleId={upstreamRuleId(row.ref.id)}
                    checked={isEnabled(selections, row.ref)}
                    onCheckedChange={(checked) => setEnabled(row.ref, checked)}
                  />
                </td>
                <td className="w-8 py-1.5 text-center text-slate-400 dark:text-muted-foreground">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-expanded={isExpanded}
                    aria-controls={detailId}
                    aria-label={isExpanded ? `Collapse ${upstreamRuleId(row.ref.id)}` : `Expand ${upstreamRuleId(row.ref.id)}`}
                    onClick={() => onToggleRule(key)}
                  >
                    {isExpanded ? '▾' : '▸'}
                  </Button>
                </td>
                <td className={`px-2 py-1.5 ${titleIndent}`}>
                  <RuleTitle row={row} />
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 md:hidden">
                    <AssessmentBadge row={row} />
                    <BenchmarkText row={row} />
                  </div>
                </td>
                <td className="hidden w-44 px-2 py-1.5 md:table-cell">
                  <AssessmentBadge row={row} />
                </td>
                <td className="hidden w-56 px-2 py-1.5 md:table-cell">
                  <BenchmarkText row={row} />
                </td>
              </tr>
              {isExpanded && (
                <tr id={detailId} className={`border-l-4 ${expandedAccent}`}>
                  <td colSpan={5} className="p-0">
                    <RuleDetailPanel ruleRef={row.ref} />
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

interface RowCheckboxProps {
  ruleId: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

// An explicit aria-labelledby makes Base UI skip its per-render lookup of the
// checkbox's associated <label> (an O(DOM size) read of the hidden input's
// .labels). Across 1,493 rows that lookup dominated every table repaint.
function RowCheckbox({ ruleId, checked, onCheckedChange }: RowCheckboxProps) {
  const labelId = useId()
  return (
    <>
      <span id={labelId} hidden>
        {`Select ${ruleId}`}
      </span>
      <Checkbox
        aria-labelledby={labelId}
        checked={checked}
        onCheckedChange={(nextChecked) => onCheckedChange(nextChecked === true)}
      />
    </>
  )
}

const ODV_PLACEHOLDER = '$ODV'

function RuleTitle({ row }: { row: RuleRow }) {
  // Only titles that mention $ODV need the rule's recommended value, so only
  // those fetch the full rule (cached by fetchRule).
  const needsValue = row.hasOdv && row.title.includes(ODV_PLACEHOLDER)
  const ruleState = useRule(needsValue ? row.ref : null)
  const value = useUsableOdvValue(ruleState.status === 'ready' ? ruleState.rule : null, row.ref)

  return (
    <div className="min-w-0">
      <span className="break-words">
        {displayWithOdv(row.title, value)}
        {row.hasOdv && (
          <span role="img" title="Has an organization-defined value" aria-label="Has an organization-defined value">
            <Settings2 className="ml-1.5 inline size-4 align-text-bottom text-indigo-500 dark:text-indigo-400" />
          </span>
        )}
      </span>
      <div className="font-mono text-xs break-all text-slate-400 dark:text-muted-foreground">{upstreamRuleId(row.ref.id)}</div>
    </div>
  )
}

function AssessmentBadge({ row }: { row: RuleRow }) {
  const index = useVocabularyIndex()
  const { label, description } = assessmentLabel(row.assessment, index)
  const isAutomated = row.assessment.status === 'automated'
  // Semantic green/amber isn't one of the preset's badge variants, so it's
  // applied as a className override on top of the base Badge.
  const badgeClass = isAutomated ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400' : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400'

  return (
    <Badge className={badgeClass} title={description ?? undefined}>
      {label}
    </Badge>
  )
}

function BenchmarkText({ row }: { row: RuleRow }) {
  const index = useVocabularyIndex()
  const selectedVersions = useFilterStore((store) => store.versions)
  const hasVersionedEntry = row.scopeKeys.some((key) => key !== NO_VERSION_KEY)
  if (!hasVersionedEntry && row.benchmarks.length === 0) return <span className="text-xs whitespace-nowrap text-slate-400 dark:text-muted-foreground italic">No version listed</span>
  const summary = benchmarkSummary(row.applicability, versionsUnder(row, selectedVersions, index), index)
  if (!summary) return <span className="text-xs whitespace-nowrap text-slate-400 dark:text-muted-foreground italic">Not in a benchmark</span>
  return <SingleLineText text={summary} />
}

// One line whatever the length, so a row's height never depends on how many
// benchmarks it lists. Text that does not fit fades out at the right edge and
// shows in full in a tooltip on hover or focus.
function SingleLineText({ text }: { text: string }) {
  const textRef = useRef<HTMLSpanElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)

  useLayoutEffect(() => {
    const element = textRef.current
    if (!element) return
    const measure = () => setIsOverflowing(element.scrollWidth > element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text])

  const fade = isOverflowing ? '[mask-image:linear-gradient(to_right,black_80%,transparent)]' : ''
  return (
    <Tooltip disabled={!isOverflowing}>
      <TooltipTrigger
        render={<span ref={textRef} />}
        tabIndex={isOverflowing ? 0 : undefined}
        data-testid="benchmark-text"
        data-overflowing={isOverflowing}
        className={`block max-w-full min-w-0 overflow-hidden text-xs whitespace-nowrap text-slate-500 dark:text-muted-foreground ${fade}`}
      >
        {text}
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  )
}
