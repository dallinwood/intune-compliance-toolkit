import { useLayoutEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { NO_VERSION_KEY } from '../../logic/applicability'
import { assessmentLabel, benchmarkSummary } from '../../logic/ruleDisplay'
import { versionsUnder } from '../../logic/ruleFilters'
import { useFilterStore } from '../../state/filterStore'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { RuleRow } from '../../types/rule-row'
import { TargetIcons } from './TargetIcons'

export function AssessmentCell({ row }: { row: RuleRow }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 md:flex-nowrap">
      <TargetIcons targetKeys={row.targetKeys} />
      <AssessmentBadge row={row} />
    </div>
  )
}

export function AssessmentBadge({ row }: { row: RuleRow }) {
  const index = useVocabularyIndex()
  const { label, description } = assessmentLabel(row.assessment, index)
  const isAutomated = row.assessment.status === 'automated'
  // Semantic green/amber isn't one of the preset's badge variants, so it's
  // applied as a className override on top of the base Badge.
  const badgeClass = isAutomated ? 'bg-success text-success-foreground' : 'bg-warning text-warning-foreground'

  return (
    <Badge className={badgeClass} title={description ?? undefined}>
      {label}
    </Badge>
  )
}

export function BenchmarkText({ row }: { row: RuleRow }) {
  const index = useVocabularyIndex()
  const selectedVersions = useFilterStore((store) => store.versions)
  const hasVersionedEntry = row.scopeKeys.some((key) => key !== NO_VERSION_KEY)
  if (!hasVersionedEntry && row.benchmarks.length === 0) return <span className="text-xs whitespace-nowrap text-muted-foreground italic">No version listed</span>
  const summary = benchmarkSummary(row.applicability, versionsUnder(row, selectedVersions, index), index)
  if (!summary) return <span className="text-xs whitespace-nowrap text-muted-foreground italic">Not in a benchmark</span>
  return <SingleLineText text={summary} />
}

// One line whatever the length, so a row's height never depends on how many
// benchmarks it lists. Text that does not fit fades out at the right edge and
// shows in full in a tooltip on hover or focus.
function SingleLineText({ text }: { text: string }) {
  const textRef = useRef<HTMLSpanElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)

  useLayoutEffect(() => {
    const element = textRef.current
    if (!element) return
    const measure = () => setIsOverflowing(element.scrollWidth > element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text])

  const fade = isOverflowing ? '[mask-image:linear-gradient(to_right,black_80%,transparent)]' : ''
  return (
    <Tooltip disabled={!isOverflowing}>
      <TooltipTrigger
        render={<span ref={textRef} />}
        tabIndex={isOverflowing ? 0 : undefined}
        data-testid="benchmark-text"
        data-overflowing={isOverflowing}
        className={`block max-w-full min-w-0 overflow-hidden text-xs whitespace-nowrap text-muted-foreground ${fade}`}
      >
        {text}
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  )
}
