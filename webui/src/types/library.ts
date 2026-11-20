// Mirrors baselines/_rule.schema.json, _index.schema.json and
// _manifest.schema.json. Field names stay snake_case exactly as in the JSON
// so fetched data can be used without a mapping layer.

export type AssessmentStatus = 'automated' | 'manual'
export type ManualReason = 'manual' | 'inherent' | 'permanent' | 'n_a' | 'supplemental' | 'no_check' | 'openscap'
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

// A script is inline (shell, possibly null) or in a file (shell_file, a
// repo-root path under baselines/); exactly one of the two is present.
export interface RuleCheck {
  shell?: string | null
  shell_file?: string
  registry?: RegistrySetting[]
  result: CheckResult | null
  additional_info: string | null
}

// 'instructions' is plain-English guidance in additional_info, never a script:
// its entries have shell null, no shell_file and (for checks) result null.
//
// 'registry' is a list of structured Windows registry settings (the registry
// body, never shell or shell_file); 'ansible' and 'goss' are inline text that
// is shown but never run. None of the three is ever scripted.
export type ScriptLanguage = 'bash' | 'powershell' | 'zsh' | 'python' | 'instructions' | 'registry' | 'ansible' | 'goss'

export type RegistryHive = 'HKLM' | 'HKCU' | 'HKU' | 'HKCR'

export type RegistryType = 'REG_DWORD' | 'REG_QWORD' | 'REG_SZ' | 'REG_EXPAND_SZ' | 'REG_MULTI_SZ' | 'REG_BINARY'

// type and data are null exactly when state is 'absent'. data is a number
// (DWORD, QWORD), a string (SZ, EXPAND_SZ), a list of strings (MULTI_SZ), an
// even-length hex string (BINARY), or a whole-value "$ODV_<name>" placeholder
// for a DWORD, QWORD, SZ or EXPAND_SZ. value_name "" is the key's default value.
export interface RegistrySetting {
  hive: RegistryHive
  path: string
  value_name: string
  type: RegistryType | null
  data: number | string | string[] | null
  state: 'present' | 'absent'
}

export interface TargetCheck {
  language: ScriptLanguage
  default: RuleCheck | null
  by_version: Record<string, RuleCheck>
}

// One of the checks a rule has for a target; name is a short label, or null
// when the language says enough.
export type CheckItem = TargetCheck & { name: string | null }

// Keyed by target name (macOS, Windows, ...); each target has a non-empty list.
export type RuleChecks = Record<string, CheckItem[]>

export type OdvDatatype = 'number' | 'string' | 'enum' | 'regex'

export interface OdvValidation {
  min?: number
  max?: number
  regex?: string
  enumValues?: string[]
}

// Where the placeholder sits in shell text, which decides when a value may be
// shown inside a displayed command.
export type OdvQuoting = 'unquoted' | 'single' | 'double'

export interface Odv {
  name: string
  datatype: OdvDatatype
  description: string
  validation: OdvValidation | null
  recommended: number | string
  by_benchmark: Record<string, number | string>
  quoting: OdvQuoting
}

// versions: null applies to every version of the target.
export interface RemediationStep {
  name: string | null
  language: ScriptLanguage
  shell?: string | null
  shell_file?: string
  registry?: RegistrySetting[]
  additional_info: string | null
  versions: string[] | null
}

// Exactly one of data (inline JSON) and data_file (a repo-root path under
// baselines/) is present.
export interface RemediationPayload {
  kind: string
  versions: string[] | null
  data?: Record<string, unknown> | unknown[]
  data_file?: string
}

export interface TargetRemediation {
  steps: RemediationStep[]
  payloads: RemediationPayload[]
}

// Keyed by target name (macOS, Windows, ...).
export type Remediation = Record<string, TargetRemediation>

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
  schema_version: 7
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
  odvs: Odv[]
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
  schema_version: 7
  source: string
  rules: IndexEntry[]
}

export interface ManifestRelease {
  tag: string
  label: string
  published_date: string
  commit_sha: string
  retrieved_date: string
  importer_format: string
  index_path: string
  rule_count: number
}

// The top-level release fields (release_tag, commit_sha, retrieved_date,
// index_path, rule_count) always describe the current (newest) release, so
// everything that browses the library keeps reading just those.
export interface ManifestSource {
  name: string
  display_name: string
  provenance: 'official' | 'community'
  release_tag: string
  commit_sha: string
  retrieved_date: string
  repository_url: string
  license: License
  index_path: string
  rule_count: number
  releases: ManifestRelease[]
}

export interface Manifest {
  schema_version: 7
  sources: ManifestSource[]
}
