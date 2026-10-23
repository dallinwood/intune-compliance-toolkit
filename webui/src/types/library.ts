// Mirrors baselines/_rule.schema.json, _index.schema.json and
// _manifest.schema.json. Field names stay snake_case exactly as in the JSON
// so fetched data can be used without a mapping layer.

export type AssessmentStatus = 'automated' | 'manual'
export type ManualReason = 'manual' | 'inherent' | 'permanent' | 'n_a' | 'supplemental' | 'no_check'
export type Architecture = 'arm64' | 'i386' | null

export interface Assessment {
  status: AssessmentStatus
  manual_reason: ManualReason | null
}

export interface BenchmarkMembership {
  name: string
  severity: string | null
}

export interface ApplicabilityEntry {
  target: string | null
  version: string | null
  benchmarks: BenchmarkMembership[]
}

export type Applicability = ApplicabilityEntry[]

export interface License {
  name: string
  url: string
  rights_holder: string
  modified: true
}

export interface CheckResult {
  type: 'integer' | 'string' | 'base64'
  value: number | string
}

export interface RuleCheck {
  shell: string | null
  result: CheckResult | null
  additional_info: string | null
}

export interface RuleChecks {
  default: RuleCheck | null
  by_version: Record<string, RuleCheck>
}

export type OdvDatatype = 'number' | 'string' | 'enum' | 'regex'

export interface OdvValidation {
  min?: number
  max?: number
  regex?: string
  enumValues?: string[]
}

export interface Odv {
  datatype: OdvDatatype
  description: string
  validation: OdvValidation | null
  recommended: number | string
  by_benchmark: Record<string, number | string>
}

export interface RemediationEntry {
  shell: string | null
  additional_info: string | null
}

export interface Remediation {
  default: RemediationEntry
  by_version: Record<string, RemediationEntry>
  mobileconfig_info: Record<string, unknown> | unknown[] | null
  mobileconfig_by_version: Record<string, Record<string, unknown> | unknown[]>
  ddm_info: Record<string, unknown> | unknown[] | null
}

export interface RuleSource {
  name: string
  release_tag: string
  commit_sha: string
  upstream_rule_id: string
  upstream_path: string
  upstream_url: string
  upstream_revision: string | null
  upstream_updated: string | null
  license: License
}

export interface Rule {
  schema_version: 4
  id: string
  title: string
  discussion: string
  discussion_format: 'asciidoc' | 'markdown'
  section_path: string[]
  source: RuleSource
  assessment: Assessment
  architecture: Architecture
  applicability: Applicability
  tags: string[]
  references: Record<string, unknown>
  check: RuleChecks | null
  odv: Odv | null
  remediation: Remediation | null
}

export interface IndexEntry {
  id: string
  title: string
  file: string
  section: string
  section_path: string[]
  assessment: Assessment
  architecture: Architecture
  applicability: Applicability
  tags: string[]
  has_odv: boolean
}

export interface RuleIndex {
  schema_version: 4
  source: string
  rules: IndexEntry[]
}

export interface ManifestSource {
  name: string
  display_name: string
  release_tag: string
  commit_sha: string
  retrieved_date: string
  repository_url: string
  license: License
  index_path: string
  rule_count: number
}

export interface Manifest {
  schema_version: 4
  sources: ManifestSource[]
}
