import { effectiveAuditMethodIndex, scriptedMethodIndexes } from '../../logic/auditMethods'
import type { OrgDefinedValue } from '../../logic/selectionEntry'
import type { AuditMethod } from '../../types/rule-detail'
import { AuditMethodCard } from './AuditMethodCard'

export function AuditMethodList({
  methods,
  selectedIndex,
  onSelect,
  organizationDefinedValues,
  radioGroupName,
}: {
  methods: AuditMethod[]
  selectedIndex: number | null
  onSelect: (index: number) => void
  organizationDefinedValues: Record<string, OrgDefinedValue>
  radioGroupName: string
}) {
  const effectiveIndex = effectiveAuditMethodIndex(methods, selectedIndex)
  // A selector only makes sense when there's an actual choice to make - one
  // scripted method is used automatically, manual methods are never chosen.
  const needsSelector = scriptedMethodIndexes(methods).length > 1

  return (
    <div className="space-y-2">
      <h5 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Audit methods</h5>
      {methods.map((method, index) => (
        <AuditMethodCard
          key={method.method_name}
          method={method}
          isEffective={index === effectiveIndex}
          showSelector={needsSelector && method.type === 'scripted'}
          radioGroupName={radioGroupName}
          onSelect={() => onSelect(index)}
          organizationDefinedValues={organizationDefinedValues}
        />
      ))}
    </div>
  )
}
