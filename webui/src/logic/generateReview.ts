// Classifies the fetched rules of the Generate screen: the selected ones and the
// supporting checks the user included. Pure, so changing a choice or a value only
// re-runs this, never a fetch.

import {
  classifyRule,
  packChunks,
  type BlockedEntry,
  type Chunk,
  type GeneratableRule,
  type ManualAttestationEntry,
} from './chunking'
import { createSelectionEntry, type SelectionEntry, type SelectionMap } from './selectionEntry'
import type { VocabularyIndex } from './vocabulary'
import type { Rule } from '../types/library'
import type { RuleRef } from './selectionEntry'

export interface PulledInOutcome {
  kind: 'generatable' | 'manual' | 'blocked'
  // The reason it is not scripted or is blocked; null when generatable.
  reason: string | null
  title: string
}

export interface ReviewClassification {
  scriptedCount: number
  chunks: Chunk[]
  manual: ManualAttestationEntry[]
  blocked: BlockedEntry[]
  // By rule id, for every included supporting check.
  pulledIn: Map<string, PulledInOutcome>
  // The selected rules that are scripted for the covered versions.
  scriptedSelectedRuleIds: Set<string>
}

export interface ReviewClassificationInput {
  selected: readonly { entry: SelectionEntry; rule: Rule }[]
  // Every included supporting check that has been fetched.
  includedSupporting: readonly { ref: RuleRef; rule: Rule }[]
  // The stored values, where a supporting check the user never selected keeps its value.
  selections: SelectionMap
  coveredVersions: string[]
  vocabularyIndex: VocabularyIndex
}

function byId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id)
}

export function classifyReview(input: ReviewClassificationInput): ReviewClassification {
  const { coveredVersions, vocabularyIndex } = input
  const generatable: GeneratableRule[] = []
  const manual: ManualAttestationEntry[] = []
  const blocked: BlockedEntry[] = []
  const pulledIn = new Map<string, PulledInOutcome>()
  const scriptedSelectedRuleIds = new Set<string>()

  for (const { entry, rule } of input.selected) {
    const result = classifyRule(rule, entry, coveredVersions, vocabularyIndex)
    if (result.kind === 'generatable') {
      generatable.push(result.rule)
      scriptedSelectedRuleIds.add(result.rule.id)
    }
    else if (result.kind === 'manual') manual.push(result.entry)
    else blocked.push(result.entry)
  }

  for (const { ref, rule } of input.includedSupporting) {
    const result = classifyRule(rule, input.selections[ref.id] ?? createSelectionEntry(ref), coveredVersions, vocabularyIndex)
    if (result.kind === 'generatable') {
      generatable.push(result.rule)
      pulledIn.set(ref.id, { kind: 'generatable', reason: null, title: result.rule.title })
    } else if (result.kind === 'manual') {
      // Not scripted for the covered versions, and never an attestation entry: the user
      // did not select it.
      pulledIn.set(ref.id, { kind: 'manual', reason: result.entry.reason, title: result.entry.title })
    } else {
      blocked.push({ ...result.entry, supportingCheck: true })
      pulledIn.set(ref.id, { kind: 'blocked', reason: result.entry.reason, title: result.entry.title })
    }
  }

  // Packing waits until nothing is blocked: a chunk built before a blocked rule is fixed
  // would only be thrown away.
  const chunks = blocked.length === 0 ? packChunks(generatable, vocabularyIndex) : []
  return {
    scriptedCount: generatable.length,
    chunks,
    manual: manual.sort(byId),
    blocked: blocked.sort(byId),
    pulledIn,
    scriptedSelectedRuleIds,
  }
}

// The supporting checks the bundle really scripts: an included check can still be manual for the
// covered versions, and then it supports nothing in the bundle.
export function scriptedSupportingCheckIds(classification: ReviewClassification): Set<string> {
  return new Set(
    [...classification.pulledIn].filter(([, outcome]) => outcome.kind === 'generatable').map(([ruleId]) => ruleId),
  )
}

