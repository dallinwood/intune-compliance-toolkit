import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Button } from '@/components/ui/button'
import { formatCount } from '../../lib/format'
import { formatCoveragePercent } from '../../logic/coveragePercent'
import { capCount, withinReach, type CappedCoverage } from '../../logic/frameworkPairs'
import { sectionsWithinReach } from '../../logic/sectionDrillDown'
import { ALL_CONTROLS_SCOPE, cappedBarLabel, type FrameworkCoverage } from '../../logic/selectionCoverage'
import { termLabel } from '../../logic/vocabulary'
import { useSupportingChecksStore } from '../../state/supportingChecksStore'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import { CoverageBar } from './CoverageBar'
import { CoverageSectionList, SupportingChecksNotes, type SectionDrillDown } from './CoverageSections'

export type CoverageMode = 'all-rules' | 'selection'

const MODE_LABELS: Record<CoverageMode, string> = { 'all-rules': 'All rules', selection: 'Your selection' }
const MODES: CoverageMode[] = ['all-rules', 'selection']

function ModeToggle({ mode, onModeChange }: { mode: CoverageMode; onModeChange: (mode: CoverageMode) => void }) {
  return (
    <div role="group" aria-label="Rules counted" className="flex gap-1.5">
      {MODES.map((option) => (
        <Button key={option} type="button" size="xs" variant={mode === option ? 'default' : 'outline'} aria-pressed={mode === option} onClick={() => onModeChange(option)}>
          {MODE_LABELS[option]}
        </Button>
      ))}
    </div>
  )
}

function WholeFrameworkBar({
  coverage,
  cap,
  scopeLabel,
  coveredLabel,
}: {
  coverage: FrameworkCoverage
  cap: FrameworkCoverage
  scopeLabel: string | null
  coveredLabel: string
}) {
  const maximum = capCount(cap)
  const scopeSuffix = scopeLabel === null ? '' : ` at ${scopeLabel}`
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground">
        <span>
          Whole framework - {formatCount(coverage.total)} controls{scopeSuffix}
        </span>
        <span>
          <span data-testid="whole-framework-percent" className="text-xl font-bold text-foreground">
            {formatCoveragePercent(capCount(coverage), coverage.total)}
          </span>{' '}
          of {coveredLabel}
        </span>
      </p>
      <CoverageBar
        covered={coverage.covered}
        coveredThroughSupporting={coverage.coveredThroughSupporting}
        relatedOnly={coverage.relatedOnly}
        total={coverage.total}
        label={cappedBarLabel(coverage, maximum)}
        capCount={maximum}
        capLabel={`max ${formatCount(maximum)}`}
      />
      <p className="text-xs text-muted-foreground">
        {formatCount(capCount(coverage))} supported
        {coverage.relatedOnly > 0 && ` · ${formatCount(coverage.relatedOnly)} related only`}
        {coverage.selectedDirectly > 0 && ` · ${formatCount(coverage.selectedDirectly)} selected directly`}
      </p>
    </div>
  )
}

function WithinReachBar({ coverage, cap, coveringLabel }: { coverage: FrameworkCoverage; cap: FrameworkCoverage; coveringLabel: string }) {
  const reach = withinReach(coverage, cap)
  if (reach.capCount === 0) return <p className="text-sm text-muted-foreground">No controls within reach yet</p>
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground">Within reach of {coveringLabel}</span> - {formatCount(reach.capCount)} controls
        </span>
        <span>
          <span className="text-xl font-bold text-foreground">{reach.percentOfCap}%</span> of the cap
        </span>
      </p>
      <CoverageBar
        covered={reach.direct}
        coveredThroughSupporting={reach.throughSupporting}
        relatedOnly={0}
        total={reach.capCount}
        label={`${formatCount(reach.direct)} supported directly, ${formatCount(reach.throughSupporting)} through supporting checks, of ${formatCount(reach.capCount)} within reach`}
        className="h-3"
      />
      <p className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
        <span>
          {formatCount(reach.direct)} direct · {formatCount(reach.throughSupporting)} through supporting checks
        </span>
        <span>{formatCount(reach.stillToGo)} still to go</span>
      </p>
    </div>
  )
}

// One covering framework's (or all of them, combined) reach into one covered framework: the
// whole framework with the cap marked, then the zoomed bar whose 100% is the cap.
export function PairCoverageReport({
  title,
  coveringLabel,
  capped,
  mode,
  onModeChange,
  scope,
  onScopeChange,
  scopes,
  drillDown,
}: {
  title: string
  coveringLabel: string
  capped: CappedCoverage
  mode: CoverageMode
  onModeChange: (mode: CoverageMode) => void
  scope: string
  onScopeChange: (scope: string) => void
  scopes: readonly string[]
  drillDown: SectionDrillDown
}) {
  const scopeId = useId()
  const vocabularyIndex = useVocabularyIndex()
  const includeSupporting = useSupportingChecksStore((store) => store.includeSupporting)
  const setIncludeSupporting = useSupportingChecksStore((store) => store.setIncludeSupporting)
  const coverage = mode === 'all-rules' ? capped.cap : capped.selection
  const scopeLabel = scope === ALL_CONTROLS_SCOPE ? null : termLabel(vocabularyIndex, 'benchmarks', scope)
  return (
    <section data-testid="pair-coverage-report" aria-label={title} className="min-w-0 space-y-4 rounded-lg border border-border bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{title}</h3>
        <ModeToggle mode={mode} onModeChange={onModeChange} />
      </div>
      <WholeFrameworkBar coverage={coverage} cap={capped.cap} scopeLabel={scopeLabel} coveredLabel={termLabel(vocabularyIndex, 'sources', coverage.sourceName)} />
      <WithinReachBar coverage={coverage} cap={capped.cap} coveringLabel={coveringLabel} />
      {mode === 'all-rules' ? (
        coverage.coveredThroughSupporting > 0 && (
          <p className="text-xs text-muted-foreground">Counts every rule of {coveringLabel} and every supporting check they offer.</p>
        )
      ) : (
        <SupportingChecksNotes coverage={coverage} includeSupporting={includeSupporting} onAddSupportingChecks={() => setIncludeSupporting(true)} />
      )}
      <div>
        <Label htmlFor={scopeId} className="mb-1 block text-xs text-muted-foreground">
          Scope
        </Label>
        <NativeSelect id={scopeId} value={scope} onChange={(event) => onScopeChange(event.target.value)} className="w-full max-w-xs">
          {scopes.map((option) => (
            <option key={option} value={option}>
              {option === ALL_CONTROLS_SCOPE ? 'All controls' : termLabel(vocabularyIndex, 'benchmarks', option)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <CoverageSectionList label={`${title} sections`} sections={sectionsWithinReach(coverage, capped.cap)} drillDown={drillDown} />
    </section>
  )
}
