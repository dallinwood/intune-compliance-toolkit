import type { RuleRef } from '../logic/selectionEntry'
import type { Applicability, Architecture, Assessment } from './library'

// One rule flattened for the browser table - built from a manifest source
// plus its index entry, so the UI never needs the full per-rule JSON just to
// list and filter.
export interface RuleRow {
  ref: RuleRef
  title: string
  targetKeys: string[]
  section: string
  sourceName: string
  releaseTag: string
  assessment: Assessment
  architecture: Architecture
  applicability: Applicability
  scopeKeys: string[]
  benchmarks: string[]
  tags: string[]
  hasOdv: boolean
}
