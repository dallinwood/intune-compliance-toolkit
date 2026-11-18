import type { OlderReleaseRows } from '../hooks/useOlderReleaseRows'
import type { ResolvedFrameworkPage } from '../logic/frameworkTabs'
import type { SelectionEntry } from '../logic/selectionEntry'
import type { ManifestSource } from '../types/library'
import type { RuleRow } from '../types/rule-row'

// Everything AppShell computes that a view may need to render.
export interface ViewContext {
  rows: RuleRow[]
  filteredRows: RuleRow[]
  isStale: boolean
  search: string
  sources: ManifestSource[]
  // The framework page the address names, resolved once; null is the card grid.
  frameworkPage: ResolvedFrameworkPage<ManifestSource> | null
  // The older release the Rules sub-tab browses instead of the current one;
  // null for the current release. filteredRows then come from its rows.
  olderRelease: OlderReleaseRows | null
  coveredVersions: string[]
  filtersOpen: boolean
  isReviewingSelection: boolean
  enabledSelections: SelectionEntry[]
  onCloseReview: () => void
}
