import type { ChangeKind } from './ruleChanges'

export const KIND_LABELS: Record<ChangeKind, string> = {
  behaviour: 'Behaviour',
  scope: 'Scope',
  wording: 'Wording',
  references: 'References',
}
