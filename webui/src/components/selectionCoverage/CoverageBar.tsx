interface CoverageBarProps {
  covered: number
  coveredThroughSupporting: number
  relatedOnly: number
  total: number
  label: string
  className?: string
}

function percentOf(count: number, total: number): number {
  return total === 0 ? 0 : (count / total) * 100
}

const THROUGH_SUPPORTING_STRIPES = {
  backgroundImage: 'repeating-linear-gradient(135deg, var(--meter-fill-secondary) 0 3px, transparent 3px 6px)',
}

// Solid is what the selection supports directly, the striped segment is what it supports only
// through supporting rules, the neutral grey is related only. The label carries the numbers.
export function CoverageBar({ covered, coveredThroughSupporting, relatedOnly, total, label, className = 'h-2' }: CoverageBarProps) {
  return (
    <div role="img" aria-label={label} className={`flex w-full gap-px overflow-hidden rounded-full bg-meter-track ring-1 ring-control-border ${className}`}>
      {covered > 0 && <div className="bg-meter-fill" style={{ width: `${percentOf(covered, total)}%` }} />}
      {coveredThroughSupporting > 0 && (
        <div style={{ width: `${percentOf(coveredThroughSupporting, total)}%`, ...THROUGH_SUPPORTING_STRIPES }} />
      )}
      {relatedOnly > 0 && <div className="bg-muted-foreground" style={{ width: `${percentOf(relatedOnly, total)}%` }} />}
    </div>
  )
}
