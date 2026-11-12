import type { MappingHop, MappingStep } from '../../logic/indirectMappings'
import { useRuleLabel } from '../../hooks/useRuleLabel'
import { useRuleMappings } from '../../state/mappingsContext'
import { MappingProvenance } from '../mappings/MappingProvenance'
import { StaleLinkNotes } from './StaleLinkNotes'

const HOP_VERBS: Record<MappingStep, string> = {
  supports: 'supports',
  'supported-by': 'is supported by',
  related: 'is related to',
}

export function MappingPathHops({ id, path }: { id: string; path: readonly MappingHop[] }) {
  const { rowsById } = useRuleMappings()
  const ruleLabel = useRuleLabel()
  return (
    <ol id={id} aria-label="Links on the way to this rule" className="mt-1 space-y-2 border-l-2 border-border pl-3">
      {path.map((hop) => {
        const fromRow = rowsById.get(hop.fromRuleId)
        const toRow = rowsById.get(hop.toRuleId)
        return (
          <li key={`${hop.fromRuleId}>${hop.toRuleId}`} className="min-w-0">
            <p className="break-words">
              {ruleLabel(hop.fromRuleId)} {HOP_VERBS[hop.step]} {ruleLabel(hop.toRuleId)}
            </p>
            <MappingProvenance mapping={hop.link.mapping} note={hop.link.note || null} />
            {fromRow !== undefined && toRow !== undefined && <StaleLinkNotes link={hop.link} fromRow={fromRow} toRow={toRow} />}
          </li>
        )
      })}
    </ol>
  )
}
