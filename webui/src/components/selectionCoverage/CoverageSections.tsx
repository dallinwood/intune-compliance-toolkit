import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { cappedBarLabel, type FrameworkCoverage, type SectionCoverage } from '../../logic/selectionCoverage'
import { CoverageBar } from './CoverageBar'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'
import { formatCount } from '../../lib/format'
import { useDisplayTitle } from '../../hooks/useDisplayTitle'
import { coveringRulesInSection, selectedFirst, type SectionWithinReach } from '../../logic/sectionDrillDown'
import { isEnabled } from '../../logic/selectionEntry'
import { termLabel } from '../../logic/vocabulary'
import { useRuleMappings } from '../../state/mappingsContext'
import { useSelectionStore } from '../../state/selectionStore'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { RuleRow } from '../../types/rule-row'
import { RuleDetailsDialog } from '../rules/RuleDetailsDialog'

const ROW_BUTTON_CLASS = 'rounded-sm text-left focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none'

function SelectableRuleRow({
  rule,
  isSelected,
  onOpenDetails,
  testId,
  children,
}: {
  rule: RuleRow
  isSelected: boolean
  onOpenDetails: () => void
  testId: string
  children: ReactNode
}) {
  const setEnabled = useSelectionStore((store) => store.setEnabled)
  const title = useDisplayTitle(rule)
  const ruleId = upstreamRuleId(rule.ref.id)
  return (
    <li className="flex items-start gap-3 py-1.5 text-sm" data-testid={testId} data-selected={isSelected}>
      <Checkbox aria-label={`Select ${ruleId}`} checked={isSelected} onCheckedChange={(checked) => setEnabled(rule.ref, checked === true)} className="mt-0.5" />
      <div className={`min-w-0 flex-1 space-y-0.5 ${isSelected ? '' : 'text-muted-foreground'}`}>
        <button type="button" onClick={onOpenDetails} className={`[overflow-wrap:anywhere] hover:underline ${ROW_BUTTON_CLASS}`}>
          <span className="font-mono text-xs">{ruleId}</span> {title}
        </button>
        {children}
      </div>
    </li>
  )
}

interface DrillDownItem {
  rule: RuleRow
  // Given the list's opener, so a secondary line can open another rule in the same dialog.
  details: (openDetails: (rule: RuleRow) => void) => ReactNode
}

// Selected rules first and the rest greyed below, as the user asked.
function DrillDownList({ label, items, testId }: { label: string; items: DrillDownItem[]; testId: string }) {
  const selections = useSelectionStore((store) => store.selections)
  const [dialogRule, setDialogRule] = useState<RuleRow | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const { selected, unselected } = selectedFirst(items, (item) => isEnabled(selections, item.rule.ref))
  const openDetails = (rule: RuleRow) => {
    setDialogRule(rule)
    setIsDialogOpen(true)
  }
  return (
    <>
      <ul aria-label={label} className="divide-y divide-border">
        {[...selected, ...unselected].map((item) => (
          <SelectableRuleRow
            key={item.rule.ref.id}
            rule={item.rule}
            isSelected={isEnabled(selections, item.rule.ref)}
            testId={testId}
            onOpenDetails={() => openDetails(item.rule)}
          >
            {item.details(openDetails)}
          </SelectableRuleRow>
        ))}
      </ul>
      {dialogRule !== null && (
        <RuleDetailsDialog
          ruleRef={dialogRule.ref}
          title={`${upstreamRuleId(dialogRule.ref.id)} - ${dialogRule.title}`}
          description="Details of this rule."
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
        />
      )}
    </>
  )
}

function CoveringRulesDrillDown({ section, coveringSources, automatedOnly }: { section: SectionCoverage; coveringSources: readonly string[]; automatedOnly: boolean }) {
  const { byRule, rowsById } = useRuleMappings()
  const vocabularyIndex = useVocabularyIndex()
  const showFrameworkLabel = coveringSources.length > 1
  const items = useMemo(() => {
    const coveringRows = [...rowsById.values()].filter((row) => coveringSources.includes(row.sourceName))
    const sectionControlIds = new Set(section.controls.map((coverage) => coverage.control.ref.id))
    return coveringRulesInSection(coveringRows, byRule, sectionControlIds, automatedOnly).map(
      ({ rule, supportedControlIds }): DrillDownItem => ({
        rule,
        details: (openDetails) => (
          <p className="text-xs [overflow-wrap:anywhere]">
            {showFrameworkLabel && <span className="text-muted-foreground">{termLabel(vocabularyIndex, 'sources', rule.sourceName)} - </span>}
            Supports{' '}
            {supportedControlIds.map((controlId, position) => {
              const control = rowsById.get(controlId)
              const upstreamControlId = upstreamRuleId(controlId)
              return (
                <Fragment key={controlId}>
                  {position > 0 && ', '}
                  {control === undefined ? (
                    upstreamControlId
                  ) : (
                    <button
                      type="button"
                      aria-label={`Open ${upstreamControlId}`}
                      onClick={() => openDetails(control)}
                      className={`text-link underline hover:no-underline ${ROW_BUTTON_CLASS}`}
                    >
                      {upstreamControlId}
                    </button>
                  )}
                </Fragment>
              )
            })}
          </p>
        ),
      }),
    )
  }, [rowsById, byRule, section, coveringSources, automatedOnly, vocabularyIndex, showFrameworkLabel])
  if (items.length === 0) return <p className="py-1.5 text-sm text-muted-foreground">No rule of this framework maps into this section.</p>
  return <DrillDownList label={`Rules supporting ${section.section}`} items={items} testId="coverage-rule" />
}

// A section lists the rules of the covering framework(s) that map into it, on both sides of a pair.
export interface SectionDrillDown {
  coveringSources: readonly string[]
  automatedOnly: boolean
}

function SectionRow({ entry, drillDown }: { entry: SectionWithinReach; drillDown: SectionDrillDown }) {
  const [isOpen, setIsOpen] = useState(false)
  const { section, capCount } = entry
  return (
    <li className="border-t border-border first:border-t-0" data-testid="coverage-section">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => setIsOpen(!isOpen)}
          className={`flex min-w-0 flex-1 basis-full flex-wrap items-baseline gap-x-3 gap-y-1 text-sm sm:basis-0 ${ROW_BUTTON_CLASS}`}
        >
          <DisclosureChevron isOpen={isOpen} className="self-center" />
          <span className="min-w-0 flex-1 break-words">{section.section}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {section.coveredThroughSupporting > 0 ? `${formatCount(section.covered)} + ${formatCount(section.coveredThroughSupporting)}` : formatCount(section.covered)} of{' '}
            {formatCount(section.total)}
          </span>
        </button>
        <div className="w-full pl-7 sm:w-28 sm:pl-0">
          <CoverageBar
            covered={section.covered}
            coveredThroughSupporting={section.coveredThroughSupporting}
            relatedOnly={section.relatedOnly}
            total={section.total}
            label={cappedBarLabel(section, capCount)}
            capCount={capCount}
            capLabel={`max ${formatCount(capCount)}`}
            capLabelDisplay="tooltip"
            className="h-1.5"
          />
        </div>
      </div>
      {isOpen && (
        <div className="pb-3 pl-7">
          <CoveringRulesDrillDown section={section} coveringSources={drillDown.coveringSources} automatedOnly={drillDown.automatedOnly} />
        </div>
      )}
    </li>
  )
}

export function CoverageSectionList({ label, sections, drillDown }: { label: string; sections: SectionWithinReach[]; drillDown: SectionDrillDown }) {
  return (
    <ul aria-label={label}>
      {sections.map((entry) => (
        <SectionRow key={entry.section.section} entry={entry} drillDown={drillDown} />
      ))}
    </ul>
  )
}

// What the supporting checks add to these numbers, and the offer to add them when they are not in the bundle.
export function SupportingChecksNotes({
  coverage,
  includeSupporting,
  onAddSupportingChecks,
}: {
  coverage: FrameworkCoverage
  includeSupporting: boolean
  onAddSupportingChecks: () => void
}) {
  const notAddedCount = coverage.potentialThroughSupporting - coverage.coveredThroughSupporting
  return (
    <>
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
    </>
  )
}
