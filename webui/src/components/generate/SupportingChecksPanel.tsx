import { useId, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { PulledInOutcome } from '../../logic/generateReview'
import { displayWithOdv, odvSubstitutionMode, usableOdvValue } from '../../logic/odv'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import type { SelectionMap } from '../../logic/selectionEntry'
import {
  groupChoiceChanges,
  isSupportingCheckIncluded,
  storedSupportingCheckChoice,
  type SupportingCheckChoices,
  type SupportingCheckOffer,
  type SupportingCheckOffers,
} from '../../logic/supportingChecks'
import { supportingCheckValueSummary } from '../../logic/supportingCheckValue'
import { useSupportingChecksStore } from '../../state/supportingChecksStore'
import type { Rule } from '../../types/library'
import type { RuleRow } from '../../types/rule-row'
import { SupportingCheckRow } from './SupportingCheckRow'
import { formatCount, pluralize } from '../../lib/format'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'

interface CollapsibleGroup {
  open: boolean
  onToggle: () => void
  listId: string
}

export function SupportingChecksPanel({
  offers,
  selectedManualControlCount,
  rowsById,
  choices,
  includedRuleIds,
  loading,
  outcomes,
  fetchedRules,
  unavailableRuleIds,
  selections,
}: {
  offers: SupportingCheckOffers
  selectedManualControlCount: number
  rowsById: ReadonlyMap<string, RuleRow>
  choices: SupportingCheckChoices
  includedRuleIds: ReadonlySet<string>
  loading: boolean
  outcomes: ReadonlyMap<string, PulledInOutcome>
  fetchedRules: ReadonlyMap<string, Rule>
  // Offered checks whose rule could not be loaded; the review stays usable unless one of them is included.
  unavailableRuleIds: ReadonlySet<string>
  selections: SelectionMap
}) {
  const setIncludeSupporting = useSupportingChecksStore((store) => store.setIncludeSupporting)
  const setRuleChoice = useSupportingChecksStore((store) => store.setRuleChoice)
  const setGroupChoice = useSupportingChecksStore((store) => store.setGroupChoice)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [throughOpen, setThroughOpen] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [needsValueOnly, setNeedsValueOnly] = useState(false)
  const headingId = useId()
  const reviewId = useId()
  const throughListId = useId()
  const filterId = useId()

  const allOffers = useMemo(() => [...offers.direct, ...offers.throughOtherRules], [offers])
  const needsValueCount = allOffers.filter((offer) => rowsById.get(offer.ruleId)?.hasOdv === true).length
  const toggleOn = choices.includeSupporting
  const isFilterActive = needsValueOnly || filterText.trim() !== ''

  function titleOf(offer: SupportingCheckOffer): string {
    const rule = fetchedRules.get(offer.ruleId)
    if (rule === undefined) return displayWithOdv(rowsById.get(offer.ruleId)?.title ?? offer.ruleId, null)
    const valueInTitle = usableOdvValue(rule.odv, odvSubstitutionMode(rule), selections[offer.ruleId]?.odvValue ?? null, rule.id)
    return displayWithOdv(rule.title, valueInTitle)
  }

  function matchesFilter(offer: SupportingCheckOffer): boolean {
    if (needsValueOnly && rowsById.get(offer.ruleId)?.hasOdv !== true) return false
    const needle = filterText.trim().toLowerCase()
    if (needle === '') return true
    const searchable = [upstreamRuleId(offer.ruleId), titleOf(offer), ...offer.supports.map((support) => upstreamRuleId(support.controlId))]
    return searchable.some((text) => text.toLowerCase().includes(needle))
  }

  function chooseForGroup(shownOffers: readonly SupportingCheckOffer[], wanted: 'include' | 'exclude') {
    const changes = groupChoiceChanges(shownOffers, wanted)
    for (const ruleId of changes.defaultRuleIds) setRuleChoice(ruleId, 'default')
    if (changes.overrideRuleIds.length > 0) setGroupChoice(changes.overrideRuleIds, wanted)
  }

  function renderRow(offer: SupportingCheckOffer) {
    const rule = fetchedRules.get(offer.ruleId)
    const storedValue = selections[offer.ruleId]?.odvValue ?? null
    const ruleRef = rowsById.get(offer.ruleId)?.ref
    if (ruleRef === undefined) return null
    const valueSummary = rule?.odv ? supportingCheckValueSummary(rule.odv, odvSubstitutionMode(rule), storedValue, rule.id) : null
    // Shown as it will be once the option is on, so the choices can be read while it is off.
    const checked = isSupportingCheckIncluded(offer, { ...choices, includeSupporting: true })
    return (
      <SupportingCheckRow
        key={offer.ruleId}
        offer={offer}
        ruleRef={ruleRef}
        rule={rule ?? null}
        storedValue={storedValue}
        title={titleOf(offer)}
        checked={checked}
        toggleDisabled={!toggleOn}
        onCheckedChange={(nowChecked) => setRuleChoice(offer.ruleId, storedSupportingCheckChoice(offer, nowChecked ? 'include' : 'exclude'))}
        needsValue={rowsById.get(offer.ruleId)?.hasOdv === true}
        valueSummary={valueSummary}
        outcome={includedRuleIds.has(offer.ruleId) ? (outcomes.get(offer.ruleId) ?? null) : null}
      />
    )
  }

  function renderGroup(heading: string, group: readonly SupportingCheckOffer[], groupLabel: string, caption: string | null, collapsible: CollapsibleGroup | null) {
    const shownOffers = group.filter(matchesFilter)
    const isOpen = collapsible === null || collapsible.open
    const headingText = `${heading} (${formatCount(group.length)})`
    const bulkScope = isFilterActive ? 'shown' : 'all'
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h4 className="text-sm font-medium text-foreground">
            {collapsible === null ? (
              headingText
            ) : (
              <button
                type="button"
                aria-expanded={collapsible.open}
                aria-controls={collapsible.listId}
                onClick={collapsible.onToggle}
                className="inline-flex items-center gap-1 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
              >
                <DisclosureChevron isOpen={collapsible.open} />
                {headingText}
              </button>
            )}
          </h4>
          {isOpen && (
            <span className="flex gap-1.5">
              <Button type="button" size="xs" variant="outline" disabled={!toggleOn} onClick={() => chooseForGroup(shownOffers, 'include')} aria-label={`Include ${bulkScope} ${groupLabel}`}>
                Include {bulkScope}
              </Button>
              <Button type="button" size="xs" variant="outline" disabled={!toggleOn} onClick={() => chooseForGroup(shownOffers, 'exclude')} aria-label={`Exclude ${bulkScope} ${groupLabel}`}>
                Exclude {bulkScope}
              </Button>
            </span>
          )}
        </div>
        {isOpen && caption !== null && <p className="text-xs text-muted-foreground">{caption}</p>}
        <ul id={collapsible?.listId} aria-label={heading} hidden={!isOpen || shownOffers.length === 0} className="divide-y divide-border rounded-lg border border-border bg-card">
          {isOpen && shownOffers.map(renderRow)}
        </ul>
        {isOpen && shownOffers.length === 0 && <p className="text-xs text-muted-foreground">No supporting checks match.</p>}
      </div>
    )
  }

  return (
    <section data-testid="supporting-checks" aria-labelledby={headingId} className="mb-4 rounded-lg border border-border bg-panel p-4">
      <h3 id={headingId} className="mb-2 text-sm font-medium text-foreground">
        Supporting checks
      </h3>
      <Label className="items-start gap-2 text-sm font-normal">
        <Checkbox checked={toggleOn} onCheckedChange={setIncludeSupporting} className="mt-0.5" />
        Add automated checks from rules that support your selected controls
      </Label>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {pluralize(allOffers.length, 'check', 'checks')} available for {formatCount(offers.controlsWithSupportIds.length)} of{' '}
        {pluralize(selectedManualControlCount, 'selected control', 'selected controls')}; {formatCount(needsValueCount)} need an organization value.
      </p>
      {toggleOn && (
        <p className="mt-1 text-sm text-foreground" aria-live="polite">
          {loading ? 'Loading supporting checks…' : `Adding ${formatCount(includedRuleIds.size)} of ${formatCount(allOffers.length)} supporting checks`}
        </p>
      )}
      {unavailableRuleIds.size > 0 && (
        <p role="alert" className="mt-2 rounded-lg border border-warning-border bg-warning p-2 text-xs text-warning-foreground">
          {pluralize(unavailableRuleIds.size, 'supporting check', 'supporting checks')} could not be loaded. Including{' '}
          {unavailableRuleIds.size === 1 ? 'it' : 'any of them'} will stop the bundle from being prepared.
        </p>
      )}
      {offers.alreadySelectedSupporterIds.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {pluralize(offers.alreadySelectedSupporterIds.length, 'supporting rule is', 'supporting rules are')} already in your selection.
        </p>
      )}

      <Button
        type="button"
        variant="link"
        size="sm"
        aria-expanded={reviewOpen}
        aria-controls={reviewId}
        onClick={() => setReviewOpen(!reviewOpen)}
        className="mt-2 -ml-3"
      >
        <DisclosureChevron isOpen={reviewOpen} className="text-link" />
        Review supporting checks ({formatCount(allOffers.length)})
      </Button>
      <div id={reviewId} hidden={!reviewOpen} className="mt-2 space-y-3">
        {reviewOpen && (
          <>
            {!toggleOn && <p className="text-xs text-muted-foreground">Turn on the option above to choose which supporting checks to add.</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor={filterId} className="sr-only">
                Filter supporting checks
              </Label>
              <Input
                id={filterId}
                type="search"
                value={filterText}
                onChange={(event) => setFilterText(event.target.value)}
                placeholder="Filter by rule, title or control"
                className="h-8 max-w-xs"
              />
              <Button type="button" size="xs" variant={needsValueOnly ? 'default' : 'outline'} aria-pressed={needsValueOnly} onClick={() => setNeedsValueOnly(!needsValueOnly)}>
                Needs an organization value ({formatCount(needsValueCount)})
              </Button>
            </div>
            {renderGroup('Direct', offers.direct, 'direct supporting checks', null, null)}
            {offers.throughOtherRules.length > 0 &&
              renderGroup(
                'Through other rules',
                offers.throughOtherRules,
                'supporting checks through other rules',
                'These support a rule that supports your selected control. Not included unless you turn them on.',
                { open: throughOpen, onToggle: () => setThroughOpen(!throughOpen), listId: throughListId },
              )}
          </>
        )}
      </div>
    </section>
  )
}
