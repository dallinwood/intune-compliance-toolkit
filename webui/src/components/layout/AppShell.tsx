import { useMemo } from 'react'
import { FilterSidebar } from '../filters/FilterSidebar'
import { RuleTable } from '../rules/RuleTable'
import { useFilterStore, type FilterState } from '../../state/filterStore'
import { useSelectionStore } from '../../state/selectionStore'
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

export function AppShell({ rows }: { rows: RuleRow[] }) {
  const filters = useFilterStore()
  const filteredRows = useMemo(() => rows.filter((row) => matchesFilters(row, filters)), [rows, filters])
  const selections = useSelectionStore((store) => store.selections)
  const clearAll = useSelectionStore((store) => store.clearAll)
  const selectedCount = useMemo(() => Object.values(selections).filter((entry) => entry.enabled).length, [selections])

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Intune Compliance Toolkit</h1>
        <div className="flex items-center gap-4 text-sm text-slate-500">
          <span>
            {filteredRows.length} of {rows.length} rules
          </span>
          <span className="font-medium text-slate-700">{selectedCount} selected</span>
          {selectedCount > 0 && (
            <button type="button" onClick={clearAll} className="text-xs text-slate-500 underline hover:text-slate-700">
              Clear selection
            </button>
          )}
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <FilterSidebar rows={rows} />
        <main className="flex-1 overflow-y-auto">
          <RuleTable rows={filteredRows} />
        </main>
      </div>
    </div>
  )
}
