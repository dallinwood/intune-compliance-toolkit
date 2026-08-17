import { effectiveAuditMethodIndex } from './auditMethods'
import { naturalIdCompare, topLevelSection } from './naturalId'
import { isSupportedOperator } from './operatorMap'
import { buildRuleEntriesForMethod, type IntuneRuleEntry } from './rulesJsonGen'
import type { RuleRef, SelectionEntry } from './selectionEntry'
import type { AuditStep, RuleDetail } from '../types/rule-detail'

export interface GeneratableRule {
  ref: RuleRef
  id: string
  title: string
  platform: string
  steps: AuditStep[]
  ruleEntries: IntuneRuleEntry[]
}

export interface ManualAttestationEntry {
  ref: RuleRef
  id: string
  title: string
  reason: string
}

export interface BlockedEntry {
  ref: RuleRef
  id: string
  title: string
  missingVariables: string[]
}

export type ClassificationResult =
  | { kind: 'generatable'; rule: GeneratableRule }
  | { kind: 'manual'; entry: ManualAttestationEntry }
  | { kind: 'blocked'; entry: BlockedEntry }

// Decides, for one enabled selection with its full rule JSON already
// fetched, whether it can go into a generated script (generatable), can
// never be scripted at all (manual), or is scriptable but waiting on an
// organization-defined value the admin hasn't entered yet (blocked - this
// must gate the download button with a visible error, not be silently
// folded into the manual-attestation list per the rest of the rule being
// otherwise ready to go).
export function classifyRule(ref: RuleRef, rule: RuleDetail, selection: SelectionEntry): ClassificationResult {
  const effectiveIndex = effectiveAuditMethodIndex(rule.audit.methods, selection.selectedAuditMethodIndex)
  const manual = (reason: string): ClassificationResult => ({ kind: 'manual', entry: { ref, id: rule.id, title: rule.title, reason } })

  if (effectiveIndex === null) {
    return manual('No scripted audit method is available for this rule.')
  }

  const method = rule.audit.methods[effectiveIndex]
  const checks = (method.steps ?? []).flatMap((step) => step.output_check)

  if (checks.length === 0) {
    return manual('The scripted method has no compliance checks attached.')
  }

  const unsupported = [...new Set(checks.filter((check) => !isSupportedOperator(check.operator)).map((check) => check.operator))]
  if (unsupported.length > 0) {
    return manual(
      `Uses an operator Intune has no native equivalent for yet (${unsupported.join(', ')}) - needs manual attestation until in-script evaluation is supported.`,
    )
  }

  const missingVariables = checks
    .filter((check) => check.value_source === 'organization_defined' && selection.organizationDefinedValues[check.variable] === undefined)
    .map((check) => check.variable)
  if (missingVariables.length > 0) {
    return { kind: 'blocked', entry: { ref, id: rule.id, title: rule.title, missingVariables } }
  }

  return {
    kind: 'generatable',
    rule: {
      ref,
      id: rule.id,
      title: rule.title,
      platform: rule.benchmark.platform,
      steps: method.steps ?? [],
      ruleEntries: buildRuleEntriesForMethod(method, rule, selection.organizationDefinedValues),
    },
  }
}

export const MAX_RULES_PER_CHUNK = 90
export const MAX_BYTES_PER_CHUNK = 90 * 1024

export interface Chunk {
  platform: string
  section: string
  partNumber: number | null
  rules: GeneratableRule[]
  ruleEntries: IntuneRuleEntry[]
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const list = grouped.get(key)
    if (list) list.push(item)
    else grouped.set(key, [item])
  }
  return grouped
}

function findDuplicateSettingNames(entries: IntuneRuleEntry[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.SettingName)) duplicates.add(entry.SettingName)
    seen.add(entry.SettingName)
  }
  return [...duplicates]
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

// Packs generatable rules into per-platform, per-top-level-section chunks
// that respect Intune's per-policy limits, never splitting a single rule's
// settings across chunks and never merging two different top-level
// sections into one chunk even when there's spare room.
export function packChunks(
  rules: GeneratableRule[],
  options: { maxRulesPerChunk?: number; maxBytesPerChunk?: number } = {},
): Chunk[] {
  const maxRulesPerChunk = options.maxRulesPerChunk ?? MAX_RULES_PER_CHUNK
  const maxBytesPerChunk = options.maxBytesPerChunk ?? MAX_BYTES_PER_CHUNK
  const chunks: Chunk[] = []

  const byPlatform = groupBy(rules, (rule) => rule.platform)
  for (const [platform, platformRules] of [...byPlatform.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const bySection = groupBy(platformRules, (rule) => topLevelSection(rule.id))
    const sortedSections = [...bySection.keys()].sort(naturalIdCompare)

    for (const section of sortedSections) {
      const sectionRules = [...bySection.get(section)!].sort((a, b) => naturalIdCompare(a.id, b.id))
      const sectionChunks: GeneratableRule[][] = []
      let current: GeneratableRule[] = []

      for (const rule of sectionRules) {
        if (rule.ruleEntries.length > maxRulesPerChunk) {
          throw new Error(
            `Rule ${rule.id} alone has ${rule.ruleEntries.length} setting(s), which exceeds the ${maxRulesPerChunk}-per-chunk cap.`,
          )
        }

        const candidate = [...current, rule]
        const candidateEntries = candidate.flatMap((r) => r.ruleEntries)
        const byteLength = utf8ByteLength(JSON.stringify(candidateEntries))

        if (current.length > 0 && (candidateEntries.length > maxRulesPerChunk || byteLength > maxBytesPerChunk)) {
          sectionChunks.push(current)
          current = [rule]
        } else {
          current = candidate
        }
      }
      if (current.length > 0) sectionChunks.push(current)

      sectionChunks.forEach((chunkRules, index) => {
        const ruleEntries = chunkRules.flatMap((rule) => rule.ruleEntries)
        const duplicates = findDuplicateSettingNames(ruleEntries)
        if (duplicates.length > 0) {
          throw new Error(
            `Duplicate SettingName(s) within one policy: ${duplicates.join(', ')} (Intune requires unique SettingName per policy).`,
          )
        }

        chunks.push({
          platform,
          section,
          partNumber: sectionChunks.length > 1 ? index + 1 : null,
          rules: chunkRules,
          ruleEntries,
        })
      })
    }
  }

  return chunks
}
