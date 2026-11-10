import { useRuleChanges } from '../../hooks/useRuleHistory'
import type { HistoryIndex } from '../../logic/historyIndex'
import type { ChangeKind } from '../../logic/ruleChanges'
import { FieldChangeList } from './FieldChangeList'

// The field changes of one rule between two releases, fetched when this is
// drawn (nothing is fetched before that).
export function ChangesBetween({
  index,
  ruleId,
  fromTag,
  toTag,
  kinds,
  focusPaths,
}: {
  index: HistoryIndex
  ruleId: string
  fromTag: string
  toTag: string
  kinds: ReadonlySet<ChangeKind> | undefined
  focusPaths?: string[][]
}) {
  const state = useRuleChanges(index, ruleId, fromTag, toTag)
  if (state.status === 'loading') return <p className="text-sm text-muted-foreground">Loading changes…</p>
  if (state.status === 'error') return <p className="text-sm text-destructive">Failed to load: {state.message}</p>
  return <FieldChangeList changes={state.changes} kinds={kinds} focusPaths={focusPaths} />
}
