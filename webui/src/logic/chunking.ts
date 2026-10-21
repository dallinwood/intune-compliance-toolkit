import type { Rule } from '../types/library'
import { serializeRulesJson } from './bundleFiles'
import { planRuleCheck, type RuleCheckPlan } from './checkPlan'
import { GENERATION_LIMITS } from './limitsConfig'
import { additionalInfoFor, manualReasonText } from './manualAttestationReport'
import { canonicalOdvValue, displayWithOdv, effectiveOdvValue, odvSubstitutionMode, usableOdvValue, validateOdvValue } from './odv'
import { compareSections } from './ruleDisplay'
import { buildRuleEntry, type IntuneRuleEntry } from './rulesJsonGen'
import { generateBashScript } from './scriptGen/bash'
import type { SelectionEntry } from './selectionEntry'

export interface GeneratableRule {
  id: string
  title: string
  section: string
  sourceName: string
  releaseTag: string
  plan: RuleCheckPlan
  ruleEntry: IntuneRuleEntry
}

export interface ManualAttestationEntry {
  id: string
  title: string
  reason: string
  // The check's additional_info from mSCP, appended after the reason.
  additionalInfo: string | null
}

export interface BlockedEntry {
  id: string
  title: string
  reason: string
}

export type ClassificationResult =
  | { kind: 'generatable'; rule: GeneratableRule }
  | { kind: 'manual'; entry: ManualAttestationEntry }
  | { kind: 'blocked'; entry: BlockedEntry }

// Matches tools/mscp_normalize.py section_of(): upstream paths are
// rules/<section>/<file>.yaml, so the section is the parent directory.
export function sectionOf(rule: Rule): string {
  const pathParts = rule.source.upstream_path.split('/')
  const section = pathParts[pathParts.length - 2]
  if (!section) throw new Error(`${rule.id}: upstream path "${rule.source.upstream_path}" has no section directory.`)
  return section
}

// Decides, for one enabled selection with its full rule JSON already
// fetched, whether it goes into a generated script, needs manual
// attestation, or is blocked on an organization value. Blocked rules gate
// the download; they are never quietly moved to the manual list, and an
// invalid stored value is never quietly replaced by the recommended one.
export function classifyRule(rule: Rule, selection: SelectionEntry, coveredVersions: string[]): ClassificationResult {
  const odvMode = odvSubstitutionMode(rule)
  const manual = (reason: string): ClassificationResult => {
    const displayOdv = usableOdvValue(rule.odv, odvMode, selection.odvValue, rule.id)
    return {
      kind: 'manual',
      entry: {
        id: rule.id,
        title: displayWithOdv(rule.title, displayOdv),
        reason,
        additionalInfo: additionalInfoFor(rule, displayOdv),
      },
    }
  }
  const blocked = (reason: string): ClassificationResult => ({
    kind: 'blocked',
    entry: { id: rule.id, title: displayWithOdv(rule.title, null), reason },
  })

  if (rule.assessment.status === 'manual') return manual(manualReasonText(rule.assessment.manual_reason))

  let odvValue = null
  if (rule.odv) {
    const effective = effectiveOdvValue(rule.odv, selection.odvValue)
    if (effective === null) return blocked('Needs an organization value')
    const canonical = canonicalOdvValue(rule.odv, effective)
    const invalidReason = validateOdvValue(rule.odv, canonical, odvMode, rule.id)
    if (invalidReason) return blocked(`Organization value is invalid: ${invalidReason}`)
    odvValue = canonical
  }

  const plan = planRuleCheck(rule, coveredVersions, odvValue)
  if ('problem' in plan) return manual(plan.problem)

  return {
    kind: 'generatable',
    rule: {
      id: rule.id,
      title: displayWithOdv(rule.title, plan.odvValue),
      section: sectionOf(rule),
      sourceName: rule.source.name,
      releaseTag: rule.source.release_tag,
      plan,
      ruleEntry: buildRuleEntry(plan, rule),
    },
  }
}

export interface Chunk {
  sourceName: string
  releaseTag: string
  section: string
  partNumber: number | null
  rules: GeneratableRule[]
  ruleEntries: IntuneRuleEntry[]
}

export interface PackOptions {
  maxRulesPerChunk?: number
  maxBytesPerChunk?: number
  maxScriptBytesPerChunk?: number
}

interface ResolvedLimits {
  maxRulesPerChunk: number
  maxBytesPerChunk: number
  maxScriptBytesPerChunk: number
}

interface ChunkGroup {
  sourceName: string
  releaseTag: string
  section: string
  rules: GeneratableRule[]
}

function groupRules(rules: GeneratableRule[]): ChunkGroup[] {
  const groupsByKey = new Map<string, ChunkGroup>()
  for (const rule of rules) {
    const key = JSON.stringify([rule.sourceName, rule.releaseTag, rule.section])
    const group = groupsByKey.get(key)
    if (group) group.rules.push(rule)
    else groupsByKey.set(key, { sourceName: rule.sourceName, releaseTag: rule.releaseTag, section: rule.section, rules: [rule] })
  }
  return [...groupsByKey.values()].sort(
    (left, right) =>
      left.sourceName.localeCompare(right.sourceName) ||
      left.releaseTag.localeCompare(right.releaseTag) ||
      compareSections(left.section, right.section),
  )
}

function assertUniqueSettingNames(rules: GeneratableRule[]): void {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const rule of rules) {
    const settingName = rule.ruleEntry.SettingName
    if (seen.has(settingName)) duplicates.add(settingName)
    seen.add(settingName)
  }
  if (duplicates.size > 0) {
    throw new Error(
      `Duplicate SettingName within one policy: ${[...duplicates].join(', ')} (Intune requires a unique SettingName per policy).`,
    )
  }
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function fitsWithinCaps(rules: GeneratableRule[], limits: ResolvedLimits): boolean {
  if (rules.length === 0) return true
  if (rules.length > limits.maxRulesPerChunk) return false
  if (utf8ByteLength(serializeRulesJson(rules.map((rule) => rule.ruleEntry))) > limits.maxBytesPerChunk) return false
  if (utf8ByteLength(generateBashScript(rules.map((rule) => rule.plan))) > limits.maxScriptBytesPerChunk) return false
  return true
}

function splitEvenlyByCount<T>(items: T[], chunkCount: number): T[][] {
  const groups: T[][] = []
  const baseSize = Math.floor(items.length / chunkCount)
  const remainder = items.length % chunkCount
  let startIndex = 0
  for (let groupIndex = 0; groupIndex < chunkCount; groupIndex += 1) {
    const size = baseSize + (groupIndex < remainder ? 1 : 0)
    groups.push(items.slice(startIndex, startIndex + size))
    startIndex += size
  }
  return groups.filter((group) => group.length > 0)
}

function greedyGroupCount(rules: GeneratableRule[], limits: ResolvedLimits): number {
  let count = 0
  let current: GeneratableRule[] = []
  for (const rule of rules) {
    const candidate = [...current, rule]
    if (current.length > 0 && !fitsWithinCaps(candidate, limits)) {
      count += 1
      current = [rule]
    } else {
      current = candidate
    }
  }
  if (current.length > 0) count += 1
  return count
}

// Packs one group's rules into as few, as evenly sized chunks as possible:
// finds the minimum chunk count a greedy fill needs, then redistributes the
// rules evenly by count across that many chunks (180 rules against a 95-rule
// cap becomes 90 + 90, not 95 + 85). The count only grows further if an even
// split breaks a byte cap. The per-rule check guarantees termination: once
// every rule fits alone, one rule per chunk always succeeds.
function packGroup(rules: GeneratableRule[], limits: ResolvedLimits): GeneratableRule[][] {
  for (const rule of rules) {
    if (!fitsWithinCaps([rule], limits)) {
      throw new Error(
        `Rule ${rule.id} alone exceeds a per-chunk limit (max ${limits.maxRulesPerChunk} settings, ` +
          `${limits.maxBytesPerChunk} rules-JSON bytes, ${limits.maxScriptBytesPerChunk} discovery-script bytes) and cannot be packed.`,
      )
    }
  }

  let chunkCount = greedyGroupCount(rules, limits)
  while (true) {
    const groups = splitEvenlyByCount(rules, chunkCount)
    if (groups.every((group) => fitsWithinCaps(group, limits))) return groups
    chunkCount += 1
  }
}

// One chunk becomes one Intune policy. Rules are grouped by source, release
// and mSCP section, and a group is never merged with another even when
// there is spare room, so each bundle file covers one recognizable section.
export function packChunks(rules: GeneratableRule[], options: PackOptions = {}): Chunk[] {
  const limits: ResolvedLimits = {
    maxRulesPerChunk: options.maxRulesPerChunk ?? GENERATION_LIMITS.maxRulesPerChunk,
    maxBytesPerChunk: options.maxBytesPerChunk ?? GENERATION_LIMITS.maxRulesJsonBytesPerChunk,
    maxScriptBytesPerChunk: options.maxScriptBytesPerChunk ?? GENERATION_LIMITS.maxScriptBytesPerChunk,
  }

  const chunks: Chunk[] = []
  for (const group of groupRules(rules)) {
    const sortedRules = [...group.rules].sort((left, right) => left.id.localeCompare(right.id))
    // Checked across the whole group, before sizing, because the script
    // generator would otherwise fail first with a less specific message.
    assertUniqueSettingNames(sortedRules)
    const parts = packGroup(sortedRules, limits)
    parts.forEach((partRules, partIndex) => {
      chunks.push({
        sourceName: group.sourceName,
        releaseTag: group.releaseTag,
        section: group.section,
        partNumber: parts.length > 1 ? partIndex + 1 : null,
        rules: partRules,
        ruleEntries: partRules.map((rule) => rule.ruleEntry),
      })
    })
  }
  return chunks
}
