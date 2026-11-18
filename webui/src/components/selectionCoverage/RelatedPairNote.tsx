import { formatCount } from '../../lib/format'
import type { FrameworkCoverage } from '../../logic/selectionCoverage'
import { CoverageBar } from './CoverageBar'

// Related links never count as coverage, so there is no cap and no percentage, only how many
// controls the other framework's rules are linked to.
export function RelatedPairNote({ otherLabel, coverage }: { otherLabel: string; coverage: FrameworkCoverage }) {
  const title = `Related to ${otherLabel}`
  return (
    <section data-testid="related-pair-note" aria-label={title} className="min-w-0 space-y-2 rounded-lg border border-border bg-panel p-4">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
        <span>Whole framework - {formatCount(coverage.total)} controls</span>
        <span>{formatCount(coverage.relatedOnly)} related only</span>
      </p>
      <CoverageBar
        covered={0}
        coveredThroughSupporting={0}
        relatedOnly={coverage.relatedOnly}
        total={coverage.total}
        label={`${formatCount(coverage.relatedOnly)} of ${formatCount(coverage.total)} related only, not counted as coverage`}
      />
      <p className="text-xs text-muted-foreground">Linked as related, not counted as coverage.</p>
    </section>
  )
}
