import { useMemo, useState } from 'react'
import { FilterSidebar } from '../filters/FilterSidebar'
import { GenerateReviewScreen } from '../generate/GenerateReviewScreen'
import { RuleTable } from '../rules/RuleTable'
import { SelectionToolbar } from '../selection/SelectionToolbar'
import { useFilterStore, type FilterState } from '../../state/filterStore'
import type { RuleRow } from '../../types/rule-row'

type FilterValues = Pick<FilterState, 'search' | 'products' | 'versions' | 'platforms' | 'profiles' | 'automatable'>

function matchesFilters(row: RuleRow, filters: FilterValues): boolean {
  if (filters.products.size > 0 && !filters.products.has(row.ref.product)) return false
  if (filters.versions.size > 0 && !filters.versions.has(row.ref.version)) return false
  if (filters.platforms.size > 0 && !filters.platforms.has(row.platform)) return false
  if (filters.profiles.size > 0 && !row.profileApplicability.some((profile) => filters.profiles.has(profile))) return false
  if (filters.automatable === 'automatable' && row.assessmentStatus !== 'Automated') return false
  if (filters.automatable === 'manual' && row.assessmentStatus !== 'Manual') return false

  const needle = filters.search.trim().toLowerCase()
  if (needle && !row.title.toLowerCase().includes(needle) && !row.ref.id.includes(needle)) return false

  return true
}

// Two views, no router needed: a Zustand store would be overkill for a
// single boolean owned by (and only ever read by) this one component.
type View = 'browse' | 'generate'

export function AppShell({ rows }: { rows: RuleRow[] }) {
  const [view, setView] = useState<View>('browse')
  const filters = useFilterStore()
  const filteredRows = useMemo(() => rows.filter((row) => matchesFilters(row, filters)), [rows, filters])

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Intune Compliance Toolkit</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-500">
            {filteredRows.length} of {rows.length} rules
          </span>
          <SelectionToolbar rows={rows} onGenerate={() => setView('generate')} />
        </div>
      </header>
      {view === 'browse' ? (
        <div className="flex flex-1 overflow-hidden">
          <FilterSidebar rows={rows} />
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
