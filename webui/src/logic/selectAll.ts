import { isEnabled, type RuleRef, type SelectionMap } from './selectionEntry'

export type SelectAllState = 'checked' | 'unchecked' | 'indeterminate'

export function selectAllState(visibleRefs: readonly RuleRef[], selections: SelectionMap): SelectAllState {
  const enabledCount = visibleRefs.filter((ref) => isEnabled(selections, ref)).length
  if (enabledCount === 0) return 'unchecked'
  return enabledCount === visibleRefs.length ? 'checked' : 'indeterminate'
}
