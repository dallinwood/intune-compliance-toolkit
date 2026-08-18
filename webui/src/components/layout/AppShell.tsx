import { useMemo, useState } from 'react'
import { FilterSidebar } from '../filters/FilterSidebar'
import { GenerateReviewScreen } from '../generate/GenerateReviewScreen'
import { RuleTable } from '../rules/RuleTable'
import { SelectionToolbar } from '../selection/SelectionToolbar'
import { matchesFilters } from '../../logic/ruleFilters'
import { useFilterStore } from '../../state/filterStore'
import type { RuleRow } from '../../types/rule-row'

// Two views, no router needed: a Zustand store would be overkill for a
// single boolean owned by (and only ever read by) this one component.
type View = 'browse' | 'generate'

export function AppShell({ rows }: { rows: RuleRow[] }) {
  const [view, setView] = useState<View>('browse')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filters = useFilterStore()
  const filteredRows = useMemo(() => rows.filter((row) => matchesFilters(row, filters)), [rows, filters])

  return (
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
          <SelectionToolbar rows={rows} onGenerate={() => setView('generate')} />
        </div>
      </header>
      {view === 'browse' ? (
        <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
          <div id="filter-sidebar" className={`${filtersOpen ? 'block' : 'hidden'} md:block`}>
            <FilterSidebar rows={rows} />
          </div>
          <main className="flex-1 overflow-y-auto">
            <RuleTable rows={filteredRows} />
          </main>
        </div>
      ) : (
        <GenerateReviewScreen onBack={() => setView('browse')} />
      )}
    </div>
  )
}
