interface CoverageBarProps {
  covered: number
  coveredThroughSupporting: number
  relatedOnly: number
  total: number
  label: string
  className?: string
  capCount?: number
  capLabel?: string
}

function percentOf(count: number, total: number): number {
  return total === 0 ? 0 : (count / total) * 100
}

const THROUGH_SUPPORTING_STRIPES = {
  backgroundImage: 'repeating-linear-gradient(135deg, var(--meter-fill-secondary) 0 3px, transparent 3px 6px)',
}

const CAP_LABEL_FLIP_PERCENT = 80

// Solid is what the selection supports directly, the striped segment is what it supports only
// through supporting rules, the neutral grey is related only. The label carries the numbers.
// The cap line marks the most today's mappings allow; it sits outside the clipped bar so it can
// stand taller than the bar and carry its label.
export function CoverageBar({
  covered,
  coveredThroughSupporting,
  relatedOnly,
  total,
  label,
  className = 'h-2',
  capCount,
  capLabel,
}: CoverageBarProps) {
  const bar = (
    <div role="img" aria-label={label} className={`flex w-full gap-px overflow-hidden rounded-full bg-meter-track ring-1 ring-control-border ${className}`}>
      {covered > 0 && <div className="bg-meter-fill" style={{ width: `${percentOf(covered, total)}%` }} />}
      {coveredThroughSupporting > 0 && (
        <div style={{ width: `${percentOf(coveredThroughSupporting, total)}%`, ...THROUGH_SUPPORTING_STRIPES }} />
      )}
      {relatedOnly > 0 && <div className="bg-muted-foreground" style={{ width: `${percentOf(relatedOnly, total)}%` }} />}
    </div>
  )
  if (capCount === undefined) return bar

  const capPercent = Math.min(percentOf(capCount, total), 100)
  const labelFlipsLeft = capPercent > CAP_LABEL_FLIP_PERCENT
  return (
    <div className="relative pt-4">
      {bar}
      <div aria-hidden="true" className="absolute -bottom-1 top-3 w-0.5 -translate-x-1/2 bg-meter-cap" style={{ left: `${capPercent}%` }}>
        {capLabel && (
          <span
            className={`absolute -top-3.5 whitespace-nowrap text-[10px] font-semibold leading-none text-meter-cap ${labelFlipsLeft ? 'right-1' : 'left-1'}`}
          >
            {capLabel}
          </span>
        )}
      </div>
    </div>
  )
}
