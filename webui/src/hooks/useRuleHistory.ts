import { useEffect, useState } from 'react'
import { fetchHistoryIndex, fetchRuleAtRelease } from '../data/history'
import { ruleTimeline, type HistoryIndex, type TimelineEntry } from '../logic/historyIndex'
import { fieldChanges, type FieldChange } from '../logic/ruleChanges'
import type { Rule } from '../types/library'

export type RuleHistoryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; index: HistoryIndex; timeline: TimelineEntry[] }

const LOADING: RuleHistoryState = { status: 'loading' }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Pass null to skip loading (a nested panel has no History tab); the hook
// still has to be called unconditionally. The result is tagged with the rule
// it was loaded for, so a stale one is never shown for another rule.
export function useRuleHistory(rule: Rule | null): RuleHistoryState {
  const [loaded, setLoaded] = useState<{ ruleId: string; state: RuleHistoryState } | null>(null)
  const ruleId = rule?.id ?? null
  const sourceName = rule?.source.name ?? null

  useEffect(() => {
    if (ruleId === null || sourceName === null) return
    let cancelled = false
    fetchHistoryIndex(sourceName)
      .then((index) => {
        if (!cancelled) setLoaded({ ruleId, state: { status: 'ready', index, timeline: ruleTimeline(index, ruleId) } })
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoaded({ ruleId, state: { status: 'error', message: messageOf(error) } })
      })
    return () => {
      cancelled = true
    }
  }, [ruleId, sourceName])

  return loaded !== null && loaded.ruleId === ruleId ? loaded.state : LOADING
}

export type RuleChangesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; changes: FieldChange[] }

// The field changes of a rule between two releases, fetched when asked for
// (null skips). Both rule files are fetched; nothing is fetched until a diff is drawn.
export function useRuleChanges(index: HistoryIndex, ruleId: string, fromTag: string | null, toTag: string | null): RuleChangesState {
  const [loaded, setLoaded] = useState<{ key: string; state: RuleChangesState } | null>(null)
  const key = fromTag !== null && toTag !== null ? `${ruleId}\n${fromTag}\n${toTag}` : null

  useEffect(() => {
    if (key === null || fromTag === null || toTag === null) return
    let cancelled = false
    Promise.all([fetchRuleAtRelease(index, ruleId, fromTag), fetchRuleAtRelease(index, ruleId, toTag)])
      .then(([before, after]) => {
        if (!cancelled) setLoaded({ key, state: { status: 'ready', changes: fieldChanges(before, after) } })
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoaded({ key, state: { status: 'error', message: messageOf(error) } })
      })
    return () => {
      cancelled = true
    }
  }, [index, ruleId, fromTag, toTag, key])

  return key !== null && loaded !== null && loaded.key === key ? loaded.state : { status: 'loading' }
}
