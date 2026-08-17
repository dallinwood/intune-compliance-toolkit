import type { AssessmentStatus } from './rule'

// One rule flattened for the browser table - built by joining a manifest
// entry (family/product/version/platform) with its index entry, so the UI
// never needs the full per-rule JSON just to list and filter.
export interface RuleRow {
  ref: {
    family: string
    product: string
    version: string
    file: string
    id: string
  }
  title: string
  assessmentStatus: AssessmentStatus
  sourceAssessmentStatus: AssessmentStatus
  platform: string
  profileApplicability: string[]
  requiresOrganizationDefinedValue: boolean
}
