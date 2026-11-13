import { useId, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import type { PulledInOutcome } from '../../logic/generateReview'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { chainAccessibleText, chainText, type SupportingCheckOffer } from '../../logic/supportingChecks'
import type { SupportingCheckValueSummary } from '../../logic/supportingCheckValue'

const SHOWN_CONTROL_COUNT = 2

function SupportsLine({ offer }: { offer: SupportingCheckOffer }) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const controlLabels = offer.supports.map((support) => upstreamRuleId(support.controlId))
  const shownLabels = controlLabels.slice(0, SHOWN_CONTROL_COUNT)
  const hiddenCount = controlLabels.length - shownLabels.length

  return (
    <p className="break-words text-xs text-muted-foreground">
      <span id={listId}>
        Supports {expanded || hiddenCount === 0 ? controlLabels.join(', ') : `${shownLabels.join(', ')} and`}
      </span>
      {hiddenCount > 0 && (
        <>
          {' '}
          <button type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)} className="text-link underline">
            {expanded ? 'Show fewer' : `${hiddenCount} more`}
          </button>
        </>
      )}
    </p>
  )
}

export function SupportingCheckRow({
  offer,
  title,
  checked,
  toggleDisabled,
  onCheckedChange,
  needsValue,
  valueSummary,
  outcome,
}: {
  offer: SupportingCheckOffer
  title: string
  checked: boolean
  toggleDisabled: boolean
  onCheckedChange: (checked: boolean) => void
  needsValue: boolean
  // Known once the rule has been fetched; null before, or when the rule has no value.
  valueSummary: SupportingCheckValueSummary | null
  // Only for an included check whose classification is known.
  outcome: PulledInOutcome | null
}) {
  const label = upstreamRuleId(offer.ruleId)
  const [shortestChain] = [...offer.supports].sort((left, right) => left.path.length - right.path.length)
  const valueClass = valueSummary?.kind === 'invalid' || valueSummary?.kind === 'missing' ? 'text-destructive' : 'text-foreground/80'

  return (
    <li data-rule-id={offer.ruleId} className="rounded border border-border bg-card px-3 py-2">
      <div className="flex items-start gap-2">
        <Checkbox
          checked={checked}
          disabled={toggleDisabled}
          onCheckedChange={onCheckedChange}
          aria-label={`Include ${label}`}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="break-words text-sm">
            <span className="font-mono break-all">{label}</span> <span className="text-foreground/90">{title}</span>
          </p>
          <SupportsLine offer={offer} />
          {offer.depth >= 2 && (
            <p aria-label={chainAccessibleText(shortestChain.path, upstreamRuleId)} className="break-words text-xs text-muted-foreground">
              {chainText(shortestChain.path, upstreamRuleId)}
            </p>
          )}
          {valueSummary !== null ? (
            <p className={`break-words text-xs ${valueClass}`}>{valueSummary.text}</p>
          ) : (
            needsValue && <p className="text-xs text-muted-foreground">Has an organization value</p>
          )}
          {outcome?.kind === 'manual' && <p className="break-words text-xs text-muted-foreground">Not scripted: {outcome.reason}</p>}
        </div>
      </div>
    </li>
  )
}
