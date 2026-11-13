import { useMemo, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { FrameworkCoverageCard } from '../components/selectionCoverage/FrameworkCoverageCard'
import { upstreamRuleId } from '../logic/ruleDisplay'
import { includedSupportingRuleIds, supportingCheckOffers } from '../logic/supportingChecks'
import { coverageFrameworks, selectedRulesSupportingNothing, type CoverageInput } from '../logic/selectionCoverage'
import { termLabel } from '../logic/vocabulary'
import { useRuleMappings } from '../state/mappingsContext'
import { useSupportingChecksStore } from '../state/supportingChecksStore'
import { useVocabularyIndex } from '../state/vocabularyContext'
import type { ViewContext } from './viewContext'

const TOGGLE_CLASS = 'rounded-sm text-sm text-link underline focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none'

export function CoverageView({ rows, enabledSelections }: Pick<ViewContext, 'rows' | 'enabledSelections'>) {
  const { byRule, rowsById } = useRuleMappings()
  const includeSupporting = useSupportingChecksStore((store) => store.includeSupporting)
  const overrides = useSupportingChecksStore((store) => store.overrides)
  const setIncludeSupporting = useSupportingChecksStore((store) => store.setIncludeSupporting)
  const vocabularyIndex = useVocabularyIndex()
  const [automatedOnly, setAutomatedOnly] = useState(false)
  const [showUnsupportedRules, setShowUnsupportedRules] = useState(false)

  const selectedRuleIds = useMemo(() => new Set(enabledSelections.map((selection) => selection.ref.id)), [enabledSelections])
  const offers = useMemo(() => supportingCheckOffers(rowsById, byRule, selectedRuleIds), [rowsById, byRule, selectedRuleIds])
  const offeredSupportingRuleIds = useMemo(
    () => new Set([...offers.direct, ...offers.throughOtherRules].map((offer) => offer.ruleId)),
    [offers],
  )
  const includedSupportingIds = useMemo(
    () => new Set(includedSupportingRuleIds(offers, { includeSupporting, overrides })),
    [offers, includeSupporting, overrides],
  )
  const input = useMemo<CoverageInput>(
    () => ({
      rows,
      mappingsByRule: byRule,
      selectedRuleIds,
      automatedOnly,
      includedSupportingRuleIds: includedSupportingIds,
      offeredSupportingRuleIds,
    }),
    [rows, byRule, selectedRuleIds, automatedOnly, includedSupportingIds, offeredSupportingRuleIds],
  )
  const frameworks = useMemo(() => {
    const { counted, relatedOnly } = coverageFrameworks(rows, byRule)
    const bySourceLabel = (left: string, right: string) =>
      termLabel(vocabularyIndex, 'sources', left).localeCompare(termLabel(vocabularyIndex, 'sources', right))
    return { counted: [...counted].sort(bySourceLabel), relatedOnly: [...relatedOnly].sort(bySourceLabel) }
  }, [rows, byRule, vocabularyIndex])
  const unsupportedRules = useMemo(() => selectedRulesSupportingNothing(input, frameworks.counted), [input, frameworks.counted])

  return (
    <main className="flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="text-lg font-semibold">Coverage of your selection ({enabledSelections.length} rules)</h1>
          <Label className="gap-2 text-sm font-normal">
            <Checkbox checked={automatedOnly} onCheckedChange={setAutomatedOnly} />
            Automated checks only
          </Label>
        </div>
        {frameworks.counted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rules in this library support another framework&apos;s controls yet.</p>
        ) : (
          <>
            {enabledSelections.length === 0 && (
              <p className="text-sm text-muted-foreground">Select rules in the Rules view to see what they support.</p>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              {frameworks.counted.map((sourceName) => (
                <FrameworkCoverageCard
                  key={sourceName}
                  input={input}
                  sourceName={sourceName}
                  vocabularyIndex={vocabularyIndex}
                  includeSupporting={includeSupporting}
                  onAddSupportingChecks={() => setIncludeSupporting(true)}
                />
              ))}
            </div>
            {frameworks.relatedOnly.map((sourceName) => (
              <p key={sourceName} className="text-sm text-muted-foreground">
                {termLabel(vocabularyIndex, 'sources', sourceName)} links to other frameworks only as related, so it has no coverage figure.
              </p>
            ))}
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-sm">{unsupportedRules.length} selected rules support no control</p>
              <p className="text-xs text-muted-foreground">Counts every selected rule, whether or not Automated checks only is on.</p>
              {unsupportedRules.length > 0 && (
                <button
                  type="button"
                  aria-expanded={showUnsupportedRules}
                  onClick={() => setShowUnsupportedRules(!showUnsupportedRules)}
                  className={TOGGLE_CLASS}
                >
                  {showUnsupportedRules ? 'Hide the list' : 'Show the list'}
                </button>
              )}
              {showUnsupportedRules && (
                <ul aria-label="Selected rules that support no control" className="space-y-1">
                  {unsupportedRules.map((row) => (
                    <li key={row.ref.id} className="break-words text-sm">
                      <span className="font-mono text-xs">{upstreamRuleId(row.ref.id)}</span> {row.title}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
