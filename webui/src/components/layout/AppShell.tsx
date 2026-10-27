import { useEffect, useMemo, useState } from 'react'
import { SelectionToolbar } from '../selection/SelectionToolbar'
import { StaleSelectionsNotice } from '../selection/StaleSelectionsNotice'
import { useDeferredFilters } from '../../hooks/useDeferredFilters'
import type { CatalogIndex } from '../../types/catalog'
import type { MappedRule } from '../../logic/mappingIndex'
import { knownFacetValues, matchesFilters } from '../../logic/ruleFilters'
import { partitionSelectionsByLibrary } from '../../logic/selectionEntry'
import type { VocabularyIndex } from '../../logic/vocabulary'
import { useFilterStore } from '../../state/filterStore'
import { DEFAULT_VIEW_ID } from '../../state/urlState'
import { resolveView } from '../../views/viewRegistry'
import { MappingsContext } from '../../state/mappingsContext'
import { useSelectionStore } from '../../state/selectionStore'
import { VocabularyContext } from '../../state/vocabularyContext'
import type { ManifestSource } from '../../types/library'
import type { RuleRow } from '../../types/rule-row'
import { AttributionFooter } from './AttributionFooter'
import { ViewTabs } from './ViewTabs'
import { WarningsNotice } from './WarningsNotice'

export function AppShell({
  rows,
  sources,
  coveredVersions,
  vocabularyIndex,
  vocabularyWarnings,
  overlayWarnings,
  mappingsByRule,
  mappingWarnings,
  catalog,
  catalogWarnings,
}: {
  rows: RuleRow[]
  sources: ManifestSource[]
  coveredVersions: string[]
  vocabularyIndex: VocabularyIndex
  vocabularyWarnings: string[]
  overlayWarnings: string[]
  mappingsByRule: ReadonlyMap<string, MappedRule[]>
  mappingWarnings: string[]
  catalog: CatalogIndex | null
  catalogWarnings: string[]
}) {
  // Review & generate is a sub-screen of the Rules view, so it is local state
  // rather than a URL view.
  const [isReviewingSelection, setIsReviewingSelection] = useState(false)
  const viewId = useFilterStore((state) => state.view)
  const setViewId = useFilterStore((state) => state.setView)
  const activeView = resolveView(viewId)
  // A view id from a shared URL that no view has is replaced, which also
  // removes it from the URL.
  useEffect(() => {
    if (viewId !== activeView.id) setViewId(activeView.id)
  }, [viewId, activeView.id, setViewId])
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
  const filteredRows = useMemo(
    () => rows.filter((row) => matchesFilters(row, deferredFilters, vocabularyIndex)),
    [rows, deferredFilters, vocabularyIndex],
  )
  const selections = useSelectionStore((store) => store.selections)
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.ref.id, row])), [rows])
  const ruleMappings = useMemo(() => ({ byRule: mappingsByRule, rowsById }), [mappingsByRule, rowsById])
  // Memoized so the review screen's fetch effect only re-runs when the
  // selection itself changes.
  const { known: knownSelections, unknownIds } = useMemo(
    () => partitionSelectionsByLibrary(selections, rowsById),
    [selections, rowsById],
  )

  return (
    <VocabularyContext value={vocabularyIndex}>
      <MappingsContext value={ruleMappings}>
        <div className="flex h-screen flex-col">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFiltersOpen((value) => !value)}
                aria-expanded={filtersOpen}
                aria-controls="filter-sidebar"
                className="rounded border border-control-border px-2 py-1 text-xs md:hidden"
              >
                Filters
              </button>
              <h1 className="text-lg font-semibold text-foreground">Intune Compliance Toolkit</h1>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-sm text-muted-foreground">
                {filteredRows.length} of {rows.length} rules
              </span>
              <SelectionToolbar
                rows={rows}
                sources={sources}
                selectedCount={knownSelections.length}
                onGenerate={() => {
                  setViewId(DEFAULT_VIEW_ID)
                  setIsReviewingSelection(true)
                }}
              />
            </div>
          </header>
          <ViewTabs activeViewId={activeView.id} />
          <WarningsNotice label="Display name problems" summary="Some display names could not be used:" warnings={vocabularyWarnings} />
          <WarningsNotice label="Custom content problems" summary="Some custom content could not be used:" warnings={overlayWarnings} />
          <WarningsNotice label="Mapping problems" summary="Some rule mappings could not be used:" warnings={mappingWarnings} />
          <WarningsNotice label="Catalog problems" summary="Some of the product and licence catalog could not be used:" warnings={catalogWarnings} />
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
            catalog,
            onCloseReview: () => setIsReviewingSelection(false),
          })}
          <AttributionFooter sources={sources} />
        </div>
      </MappingsContext>
    </VocabularyContext>
  )
}
