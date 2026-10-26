import type { Applicability, Remediation, RemediationPayload, RemediationStep, ScriptLanguage } from '../types/library'
import { versionKey } from './applicability'
import { compareVersionsDescending } from './versions'
import { termLabel, type VocabularyIndex } from './vocabulary'

const SCRIPT_LANGUAGE_LABELS: Record<ScriptLanguage, string> = {
  bash: 'Bash',
  powershell: 'PowerShell',
  zsh: 'zsh',
  python: 'Python',
}

const PAYLOAD_KIND_LABELS: Record<string, string> = {
  mobileconfig: 'Configuration profile payloads',
  ddm: 'Declarative Device Management',
}

const HEADING_SEPARATOR = ' · '

export function scriptLanguageLabel(language: ScriptLanguage): string {
  return SCRIPT_LANGUAGE_LABELS[language]
}

// A target's block is headed by the target and, when every script in it
// shares one, the language, e.g. "Windows · PowerShell".
export function targetHeading(index: VocabularyIndex, target: string, languages: readonly ScriptLanguage[]): string {
  const targetLabel = termLabel(index, 'targets', target)
  const distinctLanguages = [...new Set(languages)]
  if (distinctLanguages.length !== 1) return targetLabel
  return `${targetLabel}${HEADING_SEPARATOR}${scriptLanguageLabel(distinctLanguages[0])}`
}

function withVersions(index: VocabularyIndex, target: string, label: string, versions: string[] | null): string {
  if (versions === null) return label
  const versionLabels = versions.map((version) => termLabel(index, 'versions', versionKey(target, version)))
  return `${label} for ${versionLabels.join(', ')}`
}

export function remediationStepLabel(index: VocabularyIndex, target: string, step: RemediationStep): string {
  return withVersions(index, target, step.name ?? 'Fix', step.versions)
}

export function remediationPayloadLabel(index: VocabularyIndex, target: string, payload: RemediationPayload): string {
  const kindLabel = Object.hasOwn(PAYLOAD_KIND_LABELS, payload.kind) ? PAYLOAD_KIND_LABELS[payload.kind] : payload.kind
  return withVersions(index, target, kindLabel, payload.versions)
}

// A rule written for a named target (every mSCP rule) says so when it has no
// fix; a rule with no target at all (an ISM control) shows no section.
export function showsRemediationSection(rule: { remediation: Remediation | null; applicability: Applicability }): boolean {
  return rule.remediation !== null || rule.applicability.some((entry) => entry.target !== null)
}

function highestVersion(versions: string[]): string {
  return [...versions].sort(compareVersionsDescending)[0]
}

// Display order inside a target, matching the Check block: entries for every
// version first, then by each entry's highest version, newest first. The
// data keeps its own order; ties keep it too.
export function newestVersionsFirst<Entry extends { versions: string[] | null }>(entries: readonly Entry[]): Entry[] {
  return [...entries].sort((left, right) => {
    if (left.versions === null || right.versions === null) return Number(left.versions !== null) - Number(right.versions !== null)
    return compareVersionsDescending(highestVersion(left.versions), highestVersion(right.versions))
  })
}
