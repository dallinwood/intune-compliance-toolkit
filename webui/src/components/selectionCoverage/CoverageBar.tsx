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

// Solid is what the selection supports directly, the lighter tone is what it supports only
// through supporting rules, the neutral grey is related only. The label carries the numbers.
export function CoverageBar({ covered, coveredThroughSupporting, relatedOnly, total, label, className = 'h-2' }: CoverageBarProps) {
  return (
    <div role="img" aria-label={label} className={`flex w-full overflow-hidden rounded-full bg-muted ${className}`}>
      <div className="bg-primary" style={{ width: `${percentOf(covered, total)}%` }} />
      <div className="bg-primary/50" style={{ width: `${percentOf(coveredThroughSupporting, total)}%` }} />
      <div className="bg-muted-foreground/30" style={{ width: `${percentOf(relatedOnly, total)}%` }} />
    </div>
  )
}
