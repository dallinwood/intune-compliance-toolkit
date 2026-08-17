export type AssessmentStatus = 'Automated' | 'Manual'

// Mirrors one entry of baselines/*/_index.json's "rules" array
// (tools/generate_index.py's rule_summary()), not the full per-rule JSON.
export interface RuleIndexEntry {
  file: string
  id: string
  title: string
  assessment_status: AssessmentStatus
  source_assessment_status: AssessmentStatus
  benchmark: {
    product: string
    version: string
    platform: string
  }
  profile_applicability: string[]
  recommended_state: string | null
  requires_organization_defined_value: boolean
  variables: string[]
}

export interface RuleIndex {
  rules: RuleIndexEntry[]
}
