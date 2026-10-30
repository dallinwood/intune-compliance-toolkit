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

const PAYLOAD_BUTTON_LABELS: Record<string, string> = {
  mobileconfig: 'Configuration profile',
  ddm: 'DDM declaration',
}

const HEADING_SEPARATOR = ' · '

export function scriptLanguageLabel(language: ScriptLanguage): string {
  return SCRIPT_LANGUAGE_LABELS[language]
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

export type RemediationItem =
  | { type: 'step'; step: RemediationStep }
  | { type: 'payload'; payload: RemediationPayload }

// The short name on a fix item's button, e.g. "Bash script" or
// "Configuration profile · macOS 15". An item for every version has no scope.
export function remediationItemButtonLabel(index: VocabularyIndex, target: string, item: RemediationItem): string {
  const typeLabel =
    item.type === 'step'
      ? `${scriptLanguageLabel(item.step.language)} script`
      : Object.hasOwn(PAYLOAD_BUTTON_LABELS, item.payload.kind)
        ? PAYLOAD_BUTTON_LABELS[item.payload.kind]
        : item.payload.kind
  const versions = item.type === 'step' ? item.step.versions : item.payload.versions
  if (versions === null) return typeLabel
  const versionLabels = versions.map((version) => termLabel(index, 'versions', versionKey(target, version)))
  return `${typeLabel}${HEADING_SEPARATOR}${versionLabels.join(', ')}`
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
