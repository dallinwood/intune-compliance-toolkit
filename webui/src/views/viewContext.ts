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
  coveredVersions: string[]
  filtersOpen: boolean
  isReviewingSelection: boolean
  enabledSelections: SelectionEntry[]
  onCloseReview: () => void
}
