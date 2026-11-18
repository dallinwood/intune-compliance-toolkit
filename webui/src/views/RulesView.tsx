import { FilterSidebar } from '../components/filters/FilterSidebar'
import { RuleTable } from '../components/rules/RuleTable'
import { StatusMessage } from '@/components/ui/status-message'
import type { OlderReleaseRows } from '../hooks/useOlderReleaseRows'
import type { RuleRow } from '../types/rule-row'

function OlderReleaseNotice({ label }: { label: string }) {
  return (
    <div
      role="note"
      aria-label="Older release"
      className="mx-4 mt-3 rounded-lg border border-warning-border bg-warning p-3 text-xs break-words text-warning-foreground"
    >
      You are viewing {label}, an older release. Selecting rules, coverage and Generate use the current release.
    </div>
  )
}

// A framework page's Rules sub-tab: the filter sidebar and the rule table,
// of the current release or of an older one chosen in the header.
export function RulesView({
  rows,
  filteredRows,
  isStale,
  search,
  filtersOpen,
  hideSourceFacet,
  olderRelease,
}: {
  rows: RuleRow[]
  filteredRows: RuleRow[]
  isStale: boolean
  search: string
  filtersOpen: boolean
  hideSourceFacet: boolean
  olderRelease: OlderReleaseRows | null
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      <div id="filter-sidebar" className={`shrink-0 ${filtersOpen ? 'block' : 'hidden'} md:flex`}>
        <FilterSidebar rows={rows} hideSourceFacet={hideSourceFacet} />
      </div>
      <main className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {olderRelease !== null && <OlderReleaseNotice label={olderRelease.release.label} />}
        {olderRelease?.status === 'loading' && <StatusMessage isLoading>Loading the rules of {olderRelease.release.label}…</StatusMessage>}
        {olderRelease?.status === 'error' && (
          <StatusMessage className="text-destructive">
            Could not load the rules of {olderRelease.release.label}: {olderRelease.message}
          </StatusMessage>
        )}
        {(olderRelease === null || olderRelease.status === 'ready') && (
          <RuleTable rows={filteredRows} scopeRows={rows} isStale={isStale} search={search} isSelectionReadOnly={olderRelease !== null} />
        )}
      </main>
    </div>
  )
}
