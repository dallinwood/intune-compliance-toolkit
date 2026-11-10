import { Badge } from '@/components/ui/badge'
import { KIND_LABELS } from '../../logic/changeLabels'
import type { ChangeKind } from '../../logic/ruleChanges'

const KIND_CLASSES: Record<ChangeKind, string> = {
  behaviour: 'bg-kind-behaviour text-kind-behaviour-foreground',
  scope: 'bg-kind-scope text-kind-scope-foreground',
  wording: 'bg-kind-wording text-kind-wording-foreground',
  references: 'bg-kind-references text-kind-references-foreground',
}

export function KindTag({ kind }: { kind: ChangeKind }) {
  return <Badge className={KIND_CLASSES[kind]}>{KIND_LABELS[kind]}</Badge>
}
