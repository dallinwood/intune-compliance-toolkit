import { useEffect, useState } from 'react'
import { fetchImportedRule, fetchOverlaidRule } from '../data/ruleDetail'
import { usableOdvValues } from '../logic/odv'
import type { OverlaidRule } from '../logic/overlays'
import type { OdvValues, RuleRef } from '../logic/selectionEntry'
import { useSelectionStore } from '../state/selectionStore'
import type { Rule } from '../types/library'

// `overlaid` carries which fields custom overlays set; `rule` is already
// the overlaid rule.
export type RuleLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rule: Rule; overlaid: OverlaidRule }

const LOADING: RuleLoadState = { status: 'loading' }

const NO_OVERLAYS = (rule: Rule): OverlaidRule => ({ rule, provenance: new Map(), applied: [], skipped: [] })

async function loadImportedAsOverlaid(ref: RuleRef): Promise<OverlaidRule> {
  return NO_OVERLAYS(await fetchImportedRule(ref))
}

// Pass null to skip fetching (the hook still has to be called
// unconditionally). The loaded state is tagged with its id so a stale
// result is never shown for a different rule.
export function useRule(ruleRef: RuleRef | null): RuleLoadState {
  return useRuleFrom(ruleRef, fetchOverlaidRule)
}

// The rule as imported, without overlays: the details' fallback when the
// overlaid rule cannot be shown.
export function useImportedRule(ruleRef: RuleRef | null): RuleLoadState {
  return useRuleFrom(ruleRef, loadImportedAsOverlaid)
}

function useRuleFrom(ruleRef: RuleRef | null, load: (ref: RuleRef) => Promise<OverlaidRule>): RuleLoadState {
  const [loaded, setLoaded] = useState<{ id: string; state: RuleLoadState } | null>(null)
  const id = ruleRef?.id ?? null
  const path = ruleRef?.path ?? null

  useEffect(() => {
    if (id === null || path === null) return
    let cancelled = false
    load({ id, path })
      .then((overlaid) => {
        if (!cancelled) setLoaded({ id, state: { status: 'ready', rule: overlaid.rule, overlaid } })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoaded({ id, state: { status: 'error', message: error instanceof Error ? error.message : String(error) } })
        }
      })
    return () => {
      cancelled = true
    }
  }, [id, path, load])

  return loaded !== null && loaded.id === id ? loaded.state : LOADING
}

const NO_STORED_VALUES: OdvValues = {}

export function useStoredOdvValues(ruleRef: RuleRef): OdvValues {
  return useSelectionStore((store) => store.selections[ruleRef.id]?.odvValues ?? NO_STORED_VALUES)
}

// The values shown in place of each $ODV_<name>: the admin's value when it
// validates, else the recommended value; a name with neither is left out
// (shown as a placeholder).
export function useUsableOdvValues(rule: Rule | null, ruleRef: RuleRef): OdvValues {
  const stored = useStoredOdvValues(ruleRef)
  if (!rule) return NO_STORED_VALUES
  return usableOdvValues(rule, stored)
}
