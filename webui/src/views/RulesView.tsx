import { FilterSidebar } from '../components/filters/FilterSidebar'
import { GenerateReviewScreen } from '../components/generate/GenerateReviewScreen'
import { RuleTable } from '../components/rules/RuleTable'
import type { ViewContext } from './viewContext'

export function RulesView({
  rows,
  filteredRows,
  isStale,
  search,
  sources,
  coveredVersions,
  filtersOpen,
  isReviewingSelection,
  enabledSelections,
  onCloseReview,
}: ViewContext) {
  if (isReviewingSelection) {
    return (
      <GenerateReviewScreen
        enabledEntries={enabledSelections}
        coveredVersions={coveredVersions}
        sources={sources}
        onBack={onCloseReview}
      />
    )
  }
  return (
    <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
      <div id="filter-sidebar" className={`shrink-0 ${filtersOpen ? 'block' : 'hidden'} md:flex`}>
        <FilterSidebar rows={rows} />
      </div>
      <main className="flex-1 overflow-y-auto">
        <RuleTable rows={filteredRows} isStale={isStale} search={search} />
      </main>
    </div>
  )
}
