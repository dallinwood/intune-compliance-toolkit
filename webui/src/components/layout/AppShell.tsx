import { useMemo, useState } from 'react'
import { FilterSidebar } from '../filters/FilterSidebar'
import { GenerateReviewScreen } from '../generate/GenerateReviewScreen'
import { RuleTable } from '../rules/RuleTable'
import { SelectionToolbar } from '../selection/SelectionToolbar'
import { StaleSelectionsNotice } from '../selection/StaleSelectionsNotice'
import { matchesFilters } from '../../logic/ruleFilters'
import { partitionSelectionsByLibrary } from '../../logic/selectionEntry'
import type { VocabularyIndex } from '../../logic/vocabulary'
import { useFilterStore } from '../../state/filterStore'
import { useSelectionStore } from '../../state/selectionStore'
import { VocabularyContext } from '../../state/vocabularyContext'
import type { ManifestSource } from '../../types/library'
import type { RuleRow } from '../../types/rule-row'
import { AttributionFooter } from './AttributionFooter'
import { VocabularyWarningsNotice } from './VocabularyWarningsNotice'

// Two views, no router needed: a Zustand store would be overkill for a
// single boolean owned by (and only ever read by) this one component.
type View = 'browse' | 'generate'

export function AppShell({
  rows,
  sources,
  coveredVersions,
  vocabularyIndex,
  vocabularyWarnings,
}: {
  rows: RuleRow[]
  sources: ManifestSource[]
  coveredVersions: string[]
  vocabularyIndex: VocabularyIndex
  vocabularyWarnings: string[]
}) {
  const [view, setView] = useState<View>('browse')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filters = useFilterStore()
  const filteredRows = useMemo(
    () => rows.filter((row) => matchesFilters(row, filters, vocabularyIndex)),
    [rows, filters, vocabularyIndex],
  )
  const selections = useSelectionStore((store) => store.selections)
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.ref.id, row])), [rows])
  // Memoized so the review screen's fetch effect only re-runs when the
  // selection itself changes.
  const { known: knownSelections, unknownIds } = useMemo(
    () => partitionSelectionsByLibrary(selections, rowsById),
    [selections, rowsById],
  )

  return (
    <VocabularyContext value={vocabularyIndex}>
      <div className="flex h-screen flex-col">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFiltersOpen((value) => !value)}
              aria-expanded={filtersOpen}
              aria-controls="filter-sidebar"
              className="rounded border border-slate-300 px-2 py-1 text-xs md:hidden"
            >
              Filters
            </button>
            <h1 className="text-lg font-semibold text-slate-900">Intune Compliance Toolkit</h1>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm text-slate-500">
              {filteredRows.length} of {rows.length} rules
            </span>
            <SelectionToolbar
              rows={rows}
              sources={sources}
              selectedCount={knownSelections.length}
              onGenerate={() => setView('generate')}
            />
          </div>
        </header>
        <VocabularyWarningsNotice warnings={vocabularyWarnings} />
        <StaleSelectionsNotice unknownIds={unknownIds} />
        {view === 'browse' ? (
          <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
            <div id="filter-sidebar" className={`shrink-0 ${filtersOpen ? 'block' : 'hidden'} md:flex`}>
              <FilterSidebar rows={rows} />
            </div>
            <main className="flex-1 overflow-y-auto">
              <RuleTable rows={filteredRows} />
            </main>
          </div>
        ) : (
          <GenerateReviewScreen
            enabledEntries={knownSelections}
            coveredVersions={coveredVersions}
            onBack={() => setView('browse')}
          />
        )}
        <AttributionFooter sources={sources} />
      </div>
    </VocabularyContext>
  )
}
