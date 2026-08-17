// Mirrors baselines/_rule.schema.json - the full per-rule JSON shape,
// fetched lazily on row-expand (unlike RuleIndexEntry, which is always
// already loaded from _index.json).

export type AssessmentStatus = 'Automated' | 'Manual'
export type AuditMethodType = 'manual' | 'scripted'
export type StepRole = 'compliance_check' | 'lookup'
export type OutputDataType = 'boolean' | 'integer' | 'string'
export type Operator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'like'
export type ValueSource = 'benchmark' | 'organization_defined'
export type RemediationMethodType = 'configuration_profile' | 'manual_steps' | 'scripted'

export interface OutputCheck {
  variable: string
  data_type: OutputDataType
  operator: Operator
  value: string | number | boolean | null
  value_source: ValueSource
}

export interface AuditStep {
  step_role: StepRole
  original_command: string | null
  check_command: string
  check_command_verified: boolean
  output_description: string
  check_command_notes?: string
  output_check: OutputCheck[]
}

export interface AuditMethod {
  method_name: string
  type: AuditMethodType
  description: string
  notes?: string
  example?: string
  steps?: AuditStep[]
}

export interface RemediationStep {
  command?: string
  expected_output?: string
  result_note?: string
  purpose?: string
}

export interface RemediationMethod {
  method_name: string
  type: RemediationMethodType
  description: string
  config_keys?: Record<string, unknown>[]
  steps?: RemediationStep[]
  example?: string
  notes?: string
}

export interface CisControl {
  version: string
  control_id: string
  control_title: string
  implementation_groups: string[]
}

export interface RuleDetail {
  id: string
  title: string
  assessment_status: AssessmentStatus
  benchmark: { product: string; version: string; platform: string }
  profile_applicability: string[]
  recommended_state: string | null
  description: string
  rationale: string
  impact: string
  audit: { methods: AuditMethod[] }
  remediation: { methods: RemediationMethod[] }
  default_value: string | null
  references: string[]
  minimum_os_csp?: string | null
  additional_information: string | Record<string, unknown> | null
  extended_attributes?: {
    cis?: { grid_id: string | null; cis_controls: CisControl[] }
  }
}
