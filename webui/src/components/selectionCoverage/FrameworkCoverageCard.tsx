import { useId, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import {
  ALL_CONTROLS_SCOPE,
  frameworkCoverage,
  scopeOptions,
  type ControlCoverage,
  type CoverageInput,
  type CoverageLink,
  type SectionCoverage,
} from '../../logic/selectionCoverage'
import { compareGroupKeys, termLabel, type VocabularyIndex } from '../../logic/vocabulary'
import { CoverageBar } from './CoverageBar'

const SELECT_CLASS = 'h-8 w-full max-w-xs rounded-md border border-control-border bg-background px-2 text-sm'
const TOGGLE_CLASS = 'rounded-sm text-xs text-link underline focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none'
const ROW_BUTTON_CLASS = 'rounded-sm text-left focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none'
const OLDER_RELEASE_NOTE = 'Mapped against an older release that has since changed'

function barLabel(covered: number, total: number, relatedOnly: number): string {
  return `${covered} of ${total} supported, ${relatedOnly} related only`
}

function LinkList({ heading, links }: { heading?: string; links: CoverageLink[] }) {
  if (links.length === 0) return null
  return (
    <div className="space-y-1">
      {heading !== undefined && <p className="text-xs font-medium text-muted-foreground">{heading}</p>}
      <ul className="space-y-2">
        {links.map((link) => (
          <li key={`${link.rule.ref.id}:${link.mapping}`} className="min-w-0 text-sm">
            <p className="break-words">
              <span className="font-mono text-xs">{upstreamRuleId(link.rule.ref.id)}</span> {link.rule.title}
            </p>
            <p className="break-all font-mono text-xs text-muted-foreground">{link.mapping}</p>
            {link.note !== null && <p className="break-words text-xs text-muted-foreground">{link.note}</p>}
            {link.checkedAgainstOlderRelease && <p className="text-xs text-muted-foreground">{OLDER_RELEASE_NOTE}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ControlRow({ coverage }: { coverage: ControlCoverage }) {
  const [isOpen, setIsOpen] = useState(false)
  const { control, status } = coverage
  const summary = (
    <>
      <span className="font-mono text-xs">{upstreamRuleId(control.ref.id)}</span>
      <span className="min-w-0 break-words">{control.title}</span>
      {status === 'covered' && <Badge>Supported</Badge>}
      {status === 'related-only' && <Badge variant="outline">Related only</Badge>}
      {coverage.selectedDirectly && <Badge variant="secondary">Selected</Badge>}
    </>
  )
  const summaryClass = 'flex w-full flex-wrap items-baseline gap-x-2 gap-y-1'
  return (
    <li className="py-1.5 text-sm" data-testid="coverage-control">
      {status === 'uncovered' ? (
        <div className={`${summaryClass} text-muted-foreground`}>{summary}</div>
      ) : (
        <button type="button" aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)} className={`${summaryClass} ${ROW_BUTTON_CLASS}`}>
          {summary}
        </button>
      )}
      {isOpen && (
        <div className="mt-2 space-y-3 border-l border-border pl-3">
          <LinkList links={coverage.supportedBy} />
          <LinkList heading="Related (not counted)" links={coverage.relatedTo} />
        </div>
      )}
    </li>
  )
}

function SectionRow({ section }: { section: SectionCoverage }) {
  const [isOpen, setIsOpen] = useState(false)
  const [showUncovered, setShowUncovered] = useState(false)
  const reachedControls = section.controls.filter((control) => control.status !== 'uncovered')
  const uncoveredControls = section.controls.filter((control) => control.status === 'uncovered')
  return (
    <li className="border-t border-border first:border-t-0" data-testid="coverage-section">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className={`flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm ${ROW_BUTTON_CLASS}`}
      >
        <span className="min-w-0 basis-full break-words sm:basis-0 sm:flex-1">{section.section}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {section.covered} of {section.total}
        </span>
        <CoverageBar
          covered={section.covered}
          relatedOnly={section.relatedOnly}
          total={section.total}
          label={barLabel(section.covered, section.total, section.relatedOnly)}
          className="h-1.5 flex-1 sm:w-28 sm:flex-none"
        />
      </button>
      {isOpen && (
        <div className="pb-3 pl-2">
          <ul className="divide-y divide-border">
            {reachedControls.map((coverage) => (
              <ControlRow key={coverage.control.ref.id} coverage={coverage} />
            ))}
          </ul>
          {uncoveredControls.length > 0 && !showUncovered && (
            <button type="button" onClick={() => setShowUncovered(true)} className={`${TOGGLE_CLASS} mt-2`}>
              Show {uncoveredControls.length} uncovered
            </button>
          )}
          {showUncovered && (
            <ul className="divide-y divide-border">
              {uncoveredControls.map((coverage) => (
                <ControlRow key={coverage.control.ref.id} coverage={coverage} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

export function FrameworkCoverageCard({
  input,
  sourceName,
  vocabularyIndex,
}: {
  input: CoverageInput
  sourceName: string
  vocabularyIndex: VocabularyIndex
}) {
  const [scope, setScope] = useState(ALL_CONTROLS_SCOPE)
  const scopeId = useId()
  const label = termLabel(vocabularyIndex, 'sources', sourceName)
  const scopes = useMemo(
    () => scopeOptions(input.rows, sourceName, compareGroupKeys(vocabularyIndex, 'benchmarks')),
    [input.rows, sourceName, vocabularyIndex],
  )
  const coverage = useMemo(() => frameworkCoverage(input, sourceName, scope), [input, sourceName, scope])
  const scopeLabel = scope === ALL_CONTROLS_SCOPE ? null : termLabel(vocabularyIndex, 'benchmarks', scope)
  return (
    <section data-testid="coverage-card" aria-label={label} className="min-w-0 space-y-3 rounded-lg border border-border bg-panel p-4">
      <h2 className="text-base font-semibold">{label}</h2>
      <p className="text-sm">
        Supports {coverage.covered} of {coverage.total} controls{scopeLabel !== null && ` at ${scopeLabel}`}
        {coverage.relatedOnly > 0 && <span className="text-muted-foreground"> + {coverage.relatedOnly} related only</span>}
        {coverage.selectedDirectly > 0 && <span className="text-muted-foreground"> · {coverage.selectedDirectly} selected directly</span>}
      </p>
      <CoverageBar
        covered={coverage.covered}
        relatedOnly={coverage.relatedOnly}
        total={coverage.total}
        label={barLabel(coverage.covered, coverage.total, coverage.relatedOnly)}
      />
      <div>
        <Label htmlFor={scopeId} className="mb-1 block text-xs text-muted-foreground">
          Scope
        </Label>
        <select id={scopeId} value={scope} onChange={(event) => setScope(event.target.value)} className={SELECT_CLASS}>
          {scopes.map((option) => (
            <option key={option} value={option}>
              {option === ALL_CONTROLS_SCOPE ? 'All controls' : termLabel(vocabularyIndex, 'benchmarks', option)}
            </option>
          ))}
        </select>
      </div>
      <ul aria-label={`${label} sections`}>
        {coverage.sections.map((section) => (
          <SectionRow key={section.section} section={section} />
        ))}
      </ul>
    </section>
  )
}
