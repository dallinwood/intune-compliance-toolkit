import { ChevronRight, Loader2, Settings2 } from 'lucide-react'
import { Fragment, memo, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useDisplayTitle } from '@/hooks/useDisplayTitle'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { sectionGroupKey } from '../../logic/ruleFilters'
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
import { AssessmentCell, BenchmarkText } from './RuleRowCells'
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

  const [toggledRules, setToggledRules] = useState<ReadonlySet<string>>(new Set())
  // A rule opened through a mapped-rule link (or a shared URL holding one)
  // is open on top of the rules toggled here; collapsing it lets it go.
  const openRule = useFilterStore((store) => store.openRule)
  const closeOpenRule = useFilterStore((store) => store.closeOpenRule)
  const expandedRules = useMemo<ReadonlySet<string>>(
    () => (openRule !== null && !toggledRules.has(openRule) ? new Set([...toggledRules, openRule]) : toggledRules),
    [openRule, toggledRules],
  )
  const toggleRule = useCallback(
    (ruleKey: string) => {
      const isClosing = expandedRules.has(ruleKey)
      if (ruleKey === openRule) closeOpenRule()
      setToggledRules((current) => {
        const next = new Set(current)
        if (isClosing) next.delete(ruleKey)
        else next.add(ruleKey)
        return next
      })
    },
    [expandedRules, openRule, closeOpenRule],
  )
  const openRuleRequest = useFilterStore((store) => store.openRuleRequest)
  useRevealOpenRule({ openRule, request: openRuleRequest, pages, currentPage, shownItems, isCatchingUp }, setPage)

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
            <p className="p-6 text-sm text-muted-foreground">No rules match the current filters.</p>
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
              <Loader2 className="size-8 animate-spin text-link" aria-hidden="true" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function containsRule(items: VisibleItem[], ruleId: string): boolean {
  return items.some((item) => item.kind === 'rule' && item.row.ref.id === ruleId)
}

interface RevealState {
  openRule: string | null
  // Changes on every link click, even to the rule already open, so that
  // click reveals it again.
  request: number
  pages: { items: VisibleItem[] }[] | null
  currentPage: number
  shownItems: VisibleItem[]
  // While the table still renders the previous filters, its pages and rows
  // are not the ones the link asked for.
  isCatchingUp: boolean
}

// Once per link click (or shared URL): move to the page holding the opened
// rule, then scroll its row into view when it renders. Paging or scrolling
// away afterwards is left alone. Under infinite scroll only the rows revealed
// so far (the first 100, then more as you scroll) are searched; following a
// link narrows the table by search, so the rule is normally among them.
function useRevealOpenRule({ openRule, request, pages, currentPage, shownItems, isCatchingUp }: RevealState, setPage: (page: number) => void) {
  const pagedFor = useRef<number | null>(null)
  const scrolledFor = useRef<number | null>(null)
  useEffect(() => {
    if (openRule === null || isCatchingUp) return
    if (pages && pagedFor.current !== request) {
      const pageIndex = pages.findIndex((page) => containsRule(page.items, openRule))
      if (pageIndex === -1) return
      pagedFor.current = request
      if (pageIndex + 1 !== currentPage) {
        setPage(pageIndex + 1)
        return
      }
    }
    if (scrolledFor.current === request || !containsRule(shownItems, openRule)) return
    const row = document.querySelector(`[data-rule-id="${CSS.escape(openRule)}"]`)
    if (!row) return
    scrolledFor.current = request
    row.scrollIntoView({ block: 'start' })
  }, [openRule, request, pages, currentPage, setPage, shownItems, isCatchingUp])
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
  1: 'bg-section-1 font-semibold',
  2: 'bg-section-2 font-medium',
  3: 'bg-section-3 font-medium',
}
const SECTION_LEVEL_INDENTS: Record<number, string> = { 1: 'pl-4', 2: 'pl-8', 3: 'pl-12' }
const HEADING_TAGS = { 1: 'h2', 2: 'h3', 3: 'h4' } as const

function SectionHeader({ node, isOpen, onToggle }: { node: SectionNode; isOpen: boolean; onToggle: (sectionId: string) => void }) {
  const level = Math.min(node.depth, 3) as 1 | 2 | 3
  const HeadingTag = HEADING_TAGS[level]
  return (
    <HeadingTag className={`border-b border-border text-sm text-section-foreground ${SECTION_LEVEL_STYLES[level]}`}>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => onToggle(node.id)}
        className={`flex w-full items-center gap-1.5 py-2 pr-4 text-left hover:bg-foreground/5 ${SECTION_LEVEL_INDENTS[level]}`}
      >
        <ChevronRight className={`size-4 shrink-0 text-section-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden="true" />
        <span>
          {node.label} <span className="font-normal text-section-muted-foreground">({node.ruleCount})</span>
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
    // Fixed columns: checkbox 48 + chevron 32 + assessment 240 + benchmarks
    // 192 = 512px, and min-w leaves the flexible title column room instead of
    // squeezing it. The assessment column fits the longest badge ("Manual -
    // marked by mSCP", about 167px) plus two target icons on one line, so row
    // height never depends on a row's targets. Below md the assessment and benchmark columns fold under
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
        <col className="w-0 md:w-60" />
        <col className="w-0 md:w-48" />
      </colgroup>
      <tbody>
        {rows.map((row) => {
          const key = refKey(row.ref)
          const isExpanded = expandedRules.has(key)
          const detailId = `rule-detail-${key}`
          // Always-reserved, normally-transparent left border (rather
          // than one that appears/disappears) so toggling expand never
          // shifts the row's contents.
          const expandedAccent = isExpanded ? 'border-link bg-expanded' : 'border-transparent'
          return (
            <Fragment key={key}>
              <tr
                data-rule-id={row.ref.id}
                className={`cursor-pointer border-l-4 align-top ${expandedAccent} ${isExpanded ? 'hover:bg-expanded/70' : 'hover:bg-muted/60'}`}
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
                <td className="w-8 py-1.5 text-center text-muted-foreground">
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
                    <AssessmentCell row={row} />
                    <BenchmarkText row={row} />
                  </div>
                </td>
                <td className="hidden w-60 px-2 py-1.5 md:table-cell">
                  <AssessmentCell row={row} />
                </td>
                <td className="hidden w-48 px-2 py-1.5 md:table-cell">
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

function RuleTitle({ row }: { row: RuleRow }) {
  const title = useDisplayTitle(row)

  return (
    <div className="min-w-0">
      <span className="break-words">
        {title}
        {row.hasOdv && (
          <span role="img" title="Has an organization-defined value" aria-label="Has an organization-defined value">
            <Settings2 className="ml-1.5 inline size-4 align-text-bottom text-link" />
          </span>
        )}
      </span>
      <div className="font-mono text-xs break-all text-muted-foreground">{upstreamRuleId(row.ref.id)}</div>
    </div>
  )
}
