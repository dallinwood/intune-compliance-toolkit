import { useId, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { chainAccessibleText } from '../../logic/supportingChecks'
import {
  ALL_CONTROLS_SCOPE,
  coverageBarLabel,
  coverageHeadline,
  frameworkCoverage,
  scopeOptions,
  type ControlCoverage,
  type CoverageChain,
  type CoverageInput,
  type CoverageLink,
  type SectionCoverage,
} from '../../logic/selectionCoverage'
import { compareGroupKeys, termLabel, type VocabularyIndex } from '../../logic/vocabulary'
import { MappingProvenance } from '../mappings/MappingProvenance'
import { CoverageBar } from './CoverageBar'
import { NativeSelect } from '@/components/ui/native-select'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'
import { formatCount } from '../../lib/format'

const ROW_BUTTON_CLASS = 'rounded-sm text-left focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none'
const OLDER_RELEASE_NOTE = 'Mapped against an older release that has since changed'

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
            <div className="text-xs">
              <MappingProvenance mapping={link.mapping} note={link.note} />
            </div>
            {link.checkedAgainstOlderRelease && <p className="text-xs text-muted-foreground">{OLDER_RELEASE_NOTE}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}

// "a (supporting check) -> supports b -> supports c": the marker follows the rule that was pulled in.
function ChainLine({ chain }: { chain: CoverageChain }) {
  const [firstHop] = chain.path
  return (
    <p aria-label={chainAccessibleText(chain.path, upstreamRuleId)} className="break-words text-sm">
      <span className="font-mono text-xs">{upstreamRuleId(firstHop.fromRuleId)}</span>
      {chain.startsAtSupportingCheck && <span className="text-xs text-muted-foreground"> (supporting check)</span>}
      {chain.path.map((hop) => (
        <span key={`${hop.fromRuleId}>${hop.toRuleId}`} className="text-xs">
          {' -> supports '}
          <span className="font-mono">{upstreamRuleId(hop.toRuleId)}</span>
        </span>
      ))}
    </p>
  )
}

function chainKey(chain: CoverageChain): string {
  return chain.path.map((hop) => `${hop.fromRuleId}>${hop.toRuleId}`).join('|')
}

function ThroughChains({ chains }: { chains: CoverageChain[] }) {
  if (chains.length === 0) return null
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">Through</p>
      <ul className="space-y-2">
        {chains.map((chain) => (
          <li key={chainKey(chain)} className="min-w-0">
            <ChainLine chain={chain} />
            <div className="space-y-1 text-xs">
              {chain.path.map((hop) => (
                <MappingProvenance key={`${hop.fromRuleId}>${hop.toRuleId}`} mapping={hop.link.mapping} note={hop.link.note} />
              ))}
            </div>
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
      {status === 'covered-through-supporting' && <Badge variant="secondary">Through supporting rules</Badge>}
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
          <DisclosureChevron isOpen={isOpen} className="self-center" />
          {summary}
        </button>
      )}
      {isOpen && (
        <div className="mt-2 space-y-3 border-l border-border pl-3">
          <LinkList links={coverage.supportedBy} />
          <ThroughChains chains={coverage.throughChains} />
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
        <DisclosureChevron isOpen={isOpen} className="self-center" />
        <span className="min-w-0 basis-full break-words sm:basis-0 sm:flex-1">{section.section}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {section.coveredThroughSupporting > 0 ? `${formatCount(section.covered)} + ${formatCount(section.coveredThroughSupporting)}` : formatCount(section.covered)} of {formatCount(section.total)}
        </span>
        <CoverageBar
          covered={section.covered}
          coveredThroughSupporting={section.coveredThroughSupporting}
          relatedOnly={section.relatedOnly}
          total={section.total}
          label={coverageBarLabel(section)}
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
          {uncoveredControls.length > 0 && (
            <Button type="button" variant="link" size="xs" aria-expanded={showUncovered} onClick={() => setShowUncovered(!showUncovered)} className="mt-2">
              {showUncovered ? 'Hide uncovered' : `Show ${formatCount(uncoveredControls.length)} uncovered`}
            </Button>
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
  includeSupporting,
  onAddSupportingChecks,
}: {
  input: CoverageInput
  sourceName: string
  vocabularyIndex: VocabularyIndex
  // Whether supporting checks are added to the bundle; the card offers to add them when they are not.
  includeSupporting: boolean
  onAddSupportingChecks: () => void
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
  const notAddedCount = coverage.potentialThroughSupporting - coverage.coveredThroughSupporting
  return (
    <section data-testid="coverage-card" aria-label={label} className="min-w-0 space-y-3 rounded-lg border border-border bg-panel p-4">
      <h3 className="text-base font-semibold">{label}</h3>
      <p className="text-sm">
        {coverageHeadline(coverage, scopeLabel)}
        {coverage.relatedOnly > 0 && <span className="text-muted-foreground"> + {formatCount(coverage.relatedOnly)} related only</span>}
        {coverage.selectedDirectly > 0 && <span className="text-muted-foreground"> · {formatCount(coverage.selectedDirectly)} selected directly</span>}
      </p>
      <CoverageBar
        covered={coverage.covered}
        coveredThroughSupporting={coverage.coveredThroughSupporting}
        relatedOnly={coverage.relatedOnly}
        total={coverage.total}
        label={coverageBarLabel(coverage)}
      />
      {includeSupporting && coverage.coveredThroughSupporting > 0 && (
        <p className="text-xs text-muted-foreground">
          Counts the supporting checks you have added. Generate leaves out any it cannot script for your covered macOS versions.
        </p>
      )}
      {!includeSupporting && notAddedCount > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>+{formatCount(notAddedCount)} more through supporting checks you have not added.</span>
          <Button type="button" size="xs" variant="outline" aria-label="Add supporting checks to the bundle" onClick={onAddSupportingChecks}>
            Add supporting checks
          </Button>
        </p>
      )}
      <div>
        <Label htmlFor={scopeId} className="mb-1 block text-xs text-muted-foreground">
          Scope
        </Label>
        <NativeSelect id={scopeId} value={scope} onChange={(event) => setScope(event.target.value)} className="w-full max-w-xs">
          {scopes.map((option) => (
            <option key={option} value={option}>
              {option === ALL_CONTROLS_SCOPE ? 'All controls' : termLabel(vocabularyIndex, 'benchmarks', option)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <ul aria-label={`${label} sections`}>
        {coverage.sections.map((section) => (
          <SectionRow key={section.section} section={section} />
        ))}
      </ul>
    </section>
  )
}
