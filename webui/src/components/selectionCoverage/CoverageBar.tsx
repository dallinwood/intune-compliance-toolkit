interface CoverageBarProps {
  covered: number
  relatedOnly: number
  total: number
  label: string
  className?: string
}

function percentOf(count: number, total: number): number {
  return total === 0 ? 0 : (count / total) * 100
}

export function CoverageBar({ covered, relatedOnly, total, label, className = 'h-2' }: CoverageBarProps) {
  return (
    <div role="img" aria-label={label} className={`flex w-full overflow-hidden rounded-full bg-muted ${className}`}>
      <div className="bg-primary" style={{ width: `${percentOf(covered, total)}%` }} />
      <div className="bg-primary/40" style={{ width: `${percentOf(relatedOnly, total)}%` }} />
    </div>
  )
}
