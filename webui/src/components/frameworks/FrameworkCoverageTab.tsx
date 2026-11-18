import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { pluralize } from '../../lib/format'
import {
  combinedCoverage,
  coveringSourcesOf,
  pairCoverage,
  relatedPairCoverage,
  selectionCoverageInput,
  supportsPairsCovering,
  type CappedCoverage,
  type SelectionSettings,
  type SupportsPair,
} from '../../logic/frameworkPairs'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { ALL_CONTROLS_SCOPE, coverageFrameworks, scopeOptions, selectedRulesSupportingNothing } from '../../logic/selectionCoverage'
import { compareGroupKeys, termLabel } from '../../logic/vocabulary'
import { useRuleMappings } from '../../state/mappingsContext'
import { useSupportingChecksStore } from '../../state/supportingChecksStore'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { RuleRow } from '../../types/rule-row'
import { PairCoverageReport, type CoverageMode } from '../selectionCoverage/PairCoverageReport'
import { RelatedPairNote } from '../selectionCoverage/RelatedPairNote'

// Holds one report's toggle and scope; both reset when the tab is left, as they are not in the URL.
function CappedReport({
  title,
  coveringLabel,
  coveredSource,
  rows,
  computeCoverage,
}: {
  title: string
  coveringLabel: string
  coveredSource: string
  rows: readonly RuleRow[]
  computeCoverage: (scope: string) => CappedCoverage
}) {
  const vocabularyIndex = useVocabularyIndex()
  const [mode, setMode] = useState<CoverageMode>('selection')
  const [scope, setScope] = useState(ALL_CONTROLS_SCOPE)
  const scopes = useMemo(() => scopeOptions(rows, coveredSource, compareGroupKeys(vocabularyIndex, 'benchmarks')), [rows, coveredSource, vocabularyIndex])
  const capped = useMemo(() => computeCoverage(scope), [computeCoverage, scope])
  return (
    <PairCoverageReport
      title={title}
      coveringLabel={coveringLabel}
      capped={capped}
      mode={mode}
      onModeChange={setMode}
      scope={scope}
      onScopeChange={setScope}
      scopes={scopes}
    />
  )
}

function SupportsPairReport({
  pair,
  title,
  coveringLabel,
  rows,
  settings,
}: {
  pair: SupportsPair
  title: string
  coveringLabel: string
  rows: readonly RuleRow[]
  settings: SelectionSettings
}) {
  const { byRule } = useRuleMappings()
  const computeCoverage = useMemo(() => (scope: string) => pairCoverage(rows, byRule, pair, settings, scope), [rows, byRule, pair, settings])
  return <CappedReport title={title} coveringLabel={coveringLabel} coveredSource={pair.coveredSource} rows={rows} computeCoverage={computeCoverage} />
}

function UnsupportedSelectedRules({ unsupportedRules }: { unsupportedRules: RuleRow[] }) {
  const [showList, setShowList] = useState(false)
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="text-sm">
        {pluralize(unsupportedRules.length, 'selected rule', 'selected rules')} {unsupportedRules.length === 1 ? 'supports' : 'support'} no control
      </p>
      <p className="text-xs text-muted-foreground">Counts every selected rule, whether or not Automated checks only is on.</p>
      {unsupportedRules.length > 0 && (
        <Button type="button" variant="link" size="sm" aria-expanded={showList} onClick={() => setShowList(!showList)} className="-ml-3">
          {showList ? 'Hide the list' : 'Show the list'}
        </Button>
      )}
      {showList && (
        <ul aria-label="Selected rules that support no control" className="space-y-1">
          {unsupportedRules.map((row) => (
            <li key={row.ref.id} className="break-words text-sm">
              <span className="font-mono text-xs">{upstreamRuleId(row.ref.id)}</span> {row.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// A framework page's Coverage sub-tab: one report per framework pair it belongs to, related-only
// pairs as notes, and the combined report when two or more frameworks cover it.
export function FrameworkCoverageTab({ sourceName, rows, selectedRuleIds }: { sourceName: string; rows: readonly RuleRow[]; selectedRuleIds: ReadonlySet<string> }) {
  const { byRule, frameworkPairs } = useRuleMappings()
  const vocabularyIndex = useVocabularyIndex()
  const includeSupporting = useSupportingChecksStore((store) => store.includeSupporting)
  const overrides = useSupportingChecksStore((store) => store.overrides)
  const [automatedOnly, setAutomatedOnly] = useState(false)

  const sourceLabel = (name: string) => termLabel(vocabularyIndex, 'sources', name)
  const settings = useMemo<SelectionSettings>(
    () => ({ selectedRuleIds, automatedOnly, choices: { includeSupporting, overrides } }),
    [selectedRuleIds, automatedOnly, includeSupporting, overrides],
  )
  const pairsThisCovers = supportsPairsCovering(frameworkPairs, sourceName)
  const pairsCoveringThis = frameworkPairs.filter((pair): pair is SupportsPair => pair.kind === 'supports' && pair.coveredSource === sourceName)
  const coveringSources = useMemo(() => coveringSourcesOf(frameworkPairs, sourceName), [frameworkPairs, sourceName])
  const relatedCoverages = useMemo(
    () =>
      frameworkPairs.flatMap((pair) => {
        if (pair.kind !== 'related' || !pair.sources.includes(sourceName)) return []
        const otherSource = pair.sources[0] === sourceName ? pair.sources[1] : pair.sources[0]
        return [{ otherSource, coverage: relatedPairCoverage(rows, byRule, otherSource, sourceName) }]
      }),
    [rows, byRule, frameworkPairs, sourceName],
  )
  const computeCombinedCoverage = useMemo(
    () => (scope: string) => combinedCoverage(rows, byRule, sourceName, coveringSources, settings, scope),
    [rows, byRule, sourceName, coveringSources, settings],
  )
  const unsupportedRules = useMemo(
    () => selectedRulesSupportingNothing(selectionCoverageInput(rows, byRule, settings), coverageFrameworks(rows, byRule).counted),
    [rows, byRule, settings],
  )

  return (
    <main className="flex-1 overflow-y-auto p-4 [scrollbar-gutter:stable]">
      <div className="max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-sm text-muted-foreground">
            {selectedRuleIds.size === 0
              ? 'Select rules in the Rules tab to see what they support.'
              : `Counting your selection of ${pluralize(selectedRuleIds.size, 'rule', 'rules')}.`}
          </p>
          <Label className="gap-2 text-sm font-normal">
            <Checkbox checked={automatedOnly} onCheckedChange={setAutomatedOnly} />
            Automated checks only
          </Label>
        </div>
        {pairsThisCovers.map((pair) => (
          <SupportsPairReport
            key={`covers:${pair.coveredSource}`}
            pair={pair}
            title={`${sourceLabel(sourceName)} → ${sourceLabel(pair.coveredSource)}`}
            coveringLabel={sourceLabel(sourceName)}
            rows={rows}
            settings={settings}
          />
        ))}
        {pairsCoveringThis.map((pair) => (
          <SupportsPairReport
            key={`covered-by:${pair.coveringSource}`}
            pair={pair}
            title={`Supported by ${sourceLabel(pair.coveringSource)}`}
            coveringLabel={sourceLabel(pair.coveringSource)}
            rows={rows}
            settings={settings}
          />
        ))}
        {relatedCoverages.map(({ otherSource, coverage }) => (
          <RelatedPairNote key={`related:${otherSource}`} otherLabel={sourceLabel(otherSource)} coverage={coverage} />
        ))}
        {coveringSources.length >= 2 && (
          <div className="space-y-4 border-t border-border pt-4">
            <CappedReport
              title="All mapped frameworks"
              coveringLabel="all mapped frameworks"
              coveredSource={sourceName}
              rows={rows}
              computeCoverage={computeCombinedCoverage}
            />
          </div>
        )}
        <UnsupportedSelectedRules unsupportedRules={unsupportedRules} />
      </div>
    </main>
  )
}
