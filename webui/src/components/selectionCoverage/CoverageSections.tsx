import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { chainAccessibleText } from '../../logic/supportingChecks'
import { cappedBarLabel, type ControlCoverage, type CoverageChain, type CoverageLink, type FrameworkCoverage, type SectionCoverage } from '../../logic/selectionCoverage'
import { MappingProvenance } from '../mappings/MappingProvenance'
import { CoverageBar } from './CoverageBar'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'
import { formatCount } from '../../lib/format'
import { useDisplayTitle } from '../../hooks/useDisplayTitle'
import { controlStatusText, coveringRulesInSection, selectedFirst, type SectionWithinReach } from '../../logic/sectionDrillDown'
import { isEnabled } from '../../logic/selectionEntry'
import { useRuleMappings } from '../../state/mappingsContext'
import { useSelectionStore } from '../../state/selectionStore'
import type { RuleRow } from '../../types/rule-row'
import { RuleDetailsDialog } from '../rules/RuleDetailsDialog'

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

function ControlProvenance({ coverage }: { coverage: ControlCoverage }) {
  const [isOpen, setIsOpen] = useState(false)
  const statusText = controlStatusText(coverage.status)
  if (coverage.status === 'uncovered') return <p className="text-xs">{statusText}</p>
  return (
    <div className="text-xs">
      <button type="button" aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)} className={`inline-flex items-center gap-1 ${ROW_BUTTON_CLASS}`}>
        <DisclosureChevron isOpen={isOpen} />
        {statusText}
      </button>
      {isOpen && (
        <div className="mt-2 space-y-3 border-l border-border pl-3 text-foreground">
          <LinkList links={coverage.supportedBy} />
          <ThroughChains chains={coverage.throughChains} />
          <LinkList heading="Related (not counted)" links={coverage.relatedTo} />
        </div>
      )}
    </div>
  )
}

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

function CoveringRulesDrillDown({ section, coveringSource, automatedOnly }: { section: SectionCoverage; coveringSource: string; automatedOnly: boolean }) {
  const { byRule, rowsById } = useRuleMappings()
  const items = useMemo(() => {
    const coveringRows = [...rowsById.values()].filter((row) => row.sourceName === coveringSource)
    const sectionControlIds = new Set(section.controls.map((coverage) => coverage.control.ref.id))
    return coveringRulesInSection(coveringRows, byRule, sectionControlIds, automatedOnly).map(
      ({ rule, supportedControlIds }): DrillDownItem => ({
        rule,
        details: (openDetails) => (
          <p className="text-xs [overflow-wrap:anywhere]">
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
  }, [rowsById, byRule, section, coveringSource, automatedOnly])
  if (items.length === 0) return <p className="py-1.5 text-sm text-muted-foreground">No rule of this framework maps into this section.</p>
  return <DrillDownList label={`Rules supporting ${section.section}`} items={items} testId="coverage-rule" />
}

function CoveredControlsDrillDown({ section }: { section: SectionCoverage }) {
  const items = section.controls.map((coverage): DrillDownItem => ({ rule: coverage.control, details: () => <ControlProvenance coverage={coverage} /> }))
  return <DrillDownList label={`Controls in ${section.section}`} items={items} testId="coverage-control" />
}

// On the covering framework's page a section lists that framework's own rules; on the covered
// framework's page, and in the combined report, it lists the section's controls.
export type SectionDrillDown = { kind: 'covering-rules'; coveringSource: string; automatedOnly: boolean } | { kind: 'covered-controls' }

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
          {drillDown.kind === 'covering-rules' ? (
            <CoveringRulesDrillDown section={section} coveringSource={drillDown.coveringSource} automatedOnly={drillDown.automatedOnly} />
          ) : (
            <CoveredControlsDrillDown section={section} />
          )}
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
