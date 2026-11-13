import { useEffect, useState } from 'react'
import { fetchReferencedText } from '../data/referencedFiles'
import { fetchOverlaidRule } from '../data/ruleDetail'
import { resolveGeneratedCheckFiles } from '../logic/fileReferences'
import type { OverlaidRule } from '../logic/overlays'
import type { RuleRef } from '../logic/selectionEntry'
import type { Rule } from '../types/library'

export interface FetchedRule {
  ref: RuleRef
  // With the generated check's script files resolved, so a bundle holds exactly what an inline script would.
  rule: Rule
  overlaid: OverlaidRule
}

export type FetchedRulesState =
  | { status: 'idle' }
  | { status: 'loading' }
  // A rule that failed to load is in failedRuleIds with the reason; the others are still in rulesById,
  // so each caller decides which failures matter to it.
  | { status: 'ready'; rulesById: ReadonlyMap<string, FetchedRule>; failedRuleIds: ReadonlyMap<string, string> }

type Outcome = Extract<FetchedRulesState, { status: 'ready' }>

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const FIELD_SEPARATOR = '\t'
const REF_SEPARATOR = '\n'

function keyOf(refs: readonly RuleRef[]): string {
  return refs
    .map((ref) => `${ref.id}${FIELD_SEPARATOR}${ref.path}`)
    .sort()
    .join(REF_SEPARATOR)
}

function refsOf(key: string): RuleRef[] {
  if (key === '') return []
  return key.split(REF_SEPARATOR).map((line) => {
    const [id, path] = line.split(FIELD_SEPARATOR)
    return { id, path }
  })
}

// Fetches every rule once per distinct set of refs. The result is kept for that
// set, so turning `active` off and on again, or anything else that re-renders the
// caller, never fetches again.
export function useFetchedRules(refs: readonly RuleRef[], active: boolean): FetchedRulesState {
  const key = keyOf(refs)
  const [loaded, setLoaded] = useState<{ key: string; outcome: Outcome } | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    Promise.allSettled(
      refsOf(key).map(async (ref) => {
        const overlaid = await fetchOverlaidRule(ref)
        return { ref, rule: await resolveGeneratedCheckFiles(overlaid.rule, fetchReferencedText), overlaid }
      }),
    ).then((settlements) => {
      if (cancelled) return
      const refs = refsOf(key)
      const rulesById = new Map<string, FetchedRule>()
      const failedRuleIds = new Map<string, string>()
      settlements.forEach((settlement, position) => {
        if (settlement.status === 'fulfilled') rulesById.set(refs[position].id, settlement.value)
        else failedRuleIds.set(refs[position].id, messageOf(settlement.reason))
      })
      setLoaded({ key, outcome: { status: 'ready', rulesById, failedRuleIds } })
    })
    return () => {
      cancelled = true
    }
  }, [key, active])

  if (loaded !== null && loaded.key === key) return loaded.outcome
  return active ? { status: 'loading' } : { status: 'idle' }
}
