import { FilterSidebar } from '../components/filters/FilterSidebar'
import { RuleTable } from '../components/rules/RuleTable'
import type { RuleRow } from '../types/rule-row'

// A framework page's Rules sub-tab: the filter sidebar and the rule table.
export function RulesView({
  rows,
  filteredRows,
  isStale,
  search,
  filtersOpen,
  hideSourceFacet,
}: {
  rows: RuleRow[]
  filteredRows: RuleRow[]
  isStale: boolean
  search: string
  filtersOpen: boolean
  hideSourceFacet: boolean
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      <div id="filter-sidebar" className={`shrink-0 ${filtersOpen ? 'block' : 'hidden'} md:flex`}>
        <FilterSidebar rows={rows} hideSourceFacet={hideSourceFacet} />
      </div>
      <main className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <RuleTable rows={filteredRows} isStale={isStale} search={search} />
      </main>
    </div>
  )
}
