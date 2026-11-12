import { useDisplayTitle } from '../../hooks/useDisplayTitle'
import { useRuleLabel } from '../../hooks/useRuleLabel'
import type { IndirectPathBlock } from '../../logic/mappedRuleView'
import { throughDescription } from '../../logic/mappedRuleView'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { indirectGroupKey, type MappedRulesViewState } from '../../state/mappedRulesView'
import { useRuleMappings } from '../../state/mappingsContext'
import type { RuleRow } from '../../types/rule-row'
import { MappedSourceGroupSection } from './MappedRuleGroup'

function ThroughRuleTitle({ row }: { row: RuleRow }) {
  const title = useDisplayTitle(row)
  return <p className="line-clamp-2 text-xs text-muted-foreground">{title}</p>
}

export function IndirectPathBlockSection({
  block,
  self,
  filtering,
  view,
}: {
  block: IndirectPathBlock
  self: RuleRow
  filtering: boolean
  view: MappedRulesViewState
}) {
  const { rowsById } = useRuleMappings()
  const ruleLabel = useRuleLabel()
  const lastThroughRow = rowsById.get(block.throughRuleIds[block.throughRuleIds.length - 1])
  const throughLabel = block.throughRuleIds.map(upstreamRuleId).join(' then ')

  return (
    <section className="space-y-2">
      <div className="min-w-0 break-words">
        <h5 className="text-sm font-medium">{throughDescription(block, ruleLabel)}</h5>
        {lastThroughRow !== undefined && <ThroughRuleTitle row={lastThroughRow} />}
      </div>
      <div className="space-y-2 border-l-2 border-border pl-3">
        {block.groups.map((group) => {
          const key = indirectGroupKey(block, group.key)
          return (
            <MappedSourceGroupSection
              key={key}
              group={group}
              self={self}
              filtering={filtering}
              isOpen={filtering || view.openGroupKeys.has(key)}
              onToggle={() => view.toggleGroup(key)}
              view={view}
              headingLevel={6}
              throughLabel={throughLabel}
            />
          )
        })}
      </div>
    </section>
  )
}
