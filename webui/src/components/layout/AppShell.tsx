import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { RULE_TABLE_ID } from '../rules/ruleTableId'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SelectionToolbar } from '../selection/SelectionToolbar'
import { StaleSelectionsNotice } from '../selection/StaleSelectionsNotice'
import { useDeferredFilters } from '../../hooks/useDeferredFilters'
import type { MappedRule, MappingFileInfo } from '../../logic/mappingIndex'
import { frameworkPairs as findFrameworkPairs } from '../../logic/frameworkPairs'
import { resolveFrameworkPage } from '../../logic/frameworkTabs'
import { knownFacetValues, matchesFilters } from '../../logic/ruleFilters'
import { partitionSelectionsByLibrary } from '../../logic/selectionEntry'
import type { VocabularyIndex } from '../../logic/vocabulary'
import { replaceFrameworkTab, replaceView, useFilterStore } from '../../state/filterStore'
import { ALL_FRAMEWORKS, DEFAULT_VIEW_ID } from '../../state/urlState'
import { resolveView } from '../../views/viewRegistry'
import { MappingsContext } from '../../state/mappingsContext'
import { useSelectionStore } from '../../state/selectionStore'
import { VocabularyContext } from '../../state/vocabularyContext'
import type { ManifestSource } from '../../types/library'
import type { RuleRow } from '../../types/rule-row'
import { AttributionFooter } from './AttributionFooter'
import { CommandPalette } from './CommandPalette'
import { ViewTabs } from './ViewTabs'
import { WarningsNotice } from './WarningsNotice'
import { formatCount, pluralize } from '../../lib/format'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function SkipToRulesLink() {
  function focusRuleTable(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    document.getElementById(RULE_TABLE_ID)?.focus()
  }
  return (
    <a
      href={`#${RULE_TABLE_ID}`}
      onClick={focusRuleTable}
      className="sr-only rounded-md bg-background px-3 py-2 text-sm text-link underline focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:ring-2 focus:ring-focus-ring focus:outline-none"
    >
      Skip to rules
    </a>
  )
}

export function AppShell({
  rows,
  sources,
  coveredVersions,
  vocabularyIndex,
  vocabularyWarnings,
  overlayWarnings,
  mappingsByRule,
  mappingFiles,
  mappingWarnings,
}: {
  rows: RuleRow[]
  sources: ManifestSource[]
  coveredVersions: string[]
  vocabularyIndex: VocabularyIndex
  vocabularyWarnings: string[]
  overlayWarnings: string[]
  mappingsByRule: ReadonlyMap<string, MappedRule[]>
  mappingFiles: ReadonlyMap<string, MappingFileInfo>
  mappingWarnings: string[]
}) {
  // Review & generate is a sub-screen of the Frameworks view, so it is local
  // state rather than a URL view.
  const [isReviewingSelection, setIsReviewingSelection] = useState(false)
  const viewId = useFilterStore((state) => state.view)
  const activeView = resolveView(viewId)
  const isFrameworksView = activeView.id === DEFAULT_VIEW_ID
  const framework = useFilterStore((state) => state.framework)
  const frameworkTab = useFilterStore((state) => state.frameworkTab)
  const pairs = useMemo(() => findFrameworkPairs(rows, mappingsByRule), [rows, mappingsByRule])
  const frameworkPage = isFrameworksView ? resolveFrameworkPage(framework, frameworkTab, sources, pairs) : null
  const shownTab = frameworkPage === null || isReviewingSelection ? null : frameworkPage.tab
  const isRulesTab = shownTab === 'rules'
  // The Rules and Releases sub-tabs both have a filter sidebar.
  const hasFilterSidebar = isRulesTab || shownTab === 'releases'
  // The rules of the framework whose page is open; null lists every rule.
  const scopedSourceName = frameworkPage === null || frameworkPage.source === ALL_FRAMEWORKS ? null : frameworkPage.source.name
  // A view id from a shared URL that no view has is replaced, which also
  // removes it from the URL.
  useEffect(() => {
    if (viewId !== activeView.id) replaceView(activeView.id)
  }, [viewId, activeView.id])
  // So is a missing or disallowed sub-tab, which also makes a later sub-tab
  // change a history entry (a change from no tab is not one).
  const resolvedTab = frameworkPage?.tab ?? null
  useEffect(() => {
    if (resolvedTab !== null && frameworkTab !== resolvedTab) replaceFrameworkTab(resolvedTab)
  }, [resolvedTab, frameworkTab])
  const [filtersOpen, setFiltersOpen] = useState(false)
  // The table and the count render from deferred filters so a click or
  // keystroke updates its own control at once while the 1,493-row table
  // catches up in the background.
  const { filters: deferredFilters, isStale } = useDeferredFilters()
  const retainKnownValues = useFilterStore((state) => state.retainKnownValues)
  // Filter values restored from a shared URL that this library has no option
  // for are dropped, which also removes them from the URL.
  useEffect(() => {
    retainKnownValues(knownFacetValues(rows, vocabularyIndex))
  }, [rows, vocabularyIndex, retainKnownValues])
  // On a framework page the page is the scope, so the store's source filter
  // is ignored there rather than cleared.
  const scopedRows = useMemo(
    () => (scopedSourceName === null ? rows : rows.filter((row) => row.sourceName === scopedSourceName)),
    [rows, scopedSourceName],
  )
  const filteredRows = useMemo(() => {
    const scopedFilters = scopedSourceName === null ? deferredFilters : { ...deferredFilters, sources: new Set<string>() }
    return scopedRows.filter((row) => matchesFilters(row, scopedFilters, vocabularyIndex))
  }, [scopedRows, scopedSourceName, deferredFilters, vocabularyIndex])
  const selections = useSelectionStore((store) => store.selections)
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.ref.id, row])), [rows])
  const ruleMappings = useMemo(
    () => ({ byRule: mappingsByRule, mappingFiles, rowsById, frameworkPairs: pairs }),
    [mappingsByRule, mappingFiles, rowsById, pairs],
  )
  // Memoized so the review screen's fetch effect only re-runs when the
  // selection itself changes.
  const { known: knownSelections, unknownIds } = useMemo(
    () => partitionSelectionsByLibrary(selections, rowsById),
    [selections, rowsById],
  )

  return (
    <VocabularyContext value={vocabularyIndex}>
      <MappingsContext value={ruleMappings}>
        <TooltipProvider>
          <div className="flex h-screen flex-col">
            {isRulesTab && <SkipToRulesLink />}
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                {hasFilterSidebar && (
                  <button
                    type="button"
                    onClick={() => setFiltersOpen((value) => !value)}
                    aria-expanded={filtersOpen}
                    aria-controls="filter-sidebar"
                    className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'md:hidden')}
                  >
                    Filters
                  </button>
                )}
                <h1 className="text-lg font-semibold text-foreground">Intune Compliance Toolkit</h1>
              </div>
              {isFrameworksView && (
                <div className="flex flex-wrap items-center gap-4">
                  {isRulesTab && (
                    <span className="text-sm text-muted-foreground">
                      {formatCount(filteredRows.length)} of {pluralize(scopedRows.length, 'rule', 'rules')}
                    </span>
                  )}
                  <SelectionToolbar
                    rows={rows}
                    sources={sources}
                    selectedCount={knownSelections.length}
                    onGenerate={() => setIsReviewingSelection(true)}
                  />
                </div>
              )}
              <CommandPalette rows={rows} sources={sources} onNavigate={() => setIsReviewingSelection(false)} />
            </header>
            <ViewTabs activeViewId={activeView.id} />
            <WarningsNotice label="Display name problems" summary="Some display names could not be used:" warnings={vocabularyWarnings} />
            <WarningsNotice label="Custom content problems" summary="Some custom content could not be used:" warnings={overlayWarnings} />
            <WarningsNotice label="Mapping problems" summary="Some rule mappings could not be used:" warnings={mappingWarnings} />
            <StaleSelectionsNotice unknownIds={unknownIds} />
            {activeView.render({
              rows,
              filteredRows,
              isStale,
              search: deferredFilters.search,
              sources,
              coveredVersions,
              filtersOpen,
              isReviewingSelection,
              enabledSelections: knownSelections,
              onCloseReview: () => setIsReviewingSelection(false),
            })}
            <AttributionFooter sources={sources} />
          </div>
        </TooltipProvider>
      </MappingsContext>
    </VocabularyContext>
  )
}
