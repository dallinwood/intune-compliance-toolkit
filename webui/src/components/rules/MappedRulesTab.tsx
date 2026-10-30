import { ChevronDown, ChevronRight } from 'lucide-react'
import { useId, useMemo, useState, type MouseEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useDisplayTitle } from '../../hooks/useDisplayTitle'
import {
  filterMappedRuleGroups,
  groupMappedRulesBySource,
  isFilterActive,
  type AssessmentChoice,
  type MappedRuleFilter,
  type MappedRuleItem,
  type MappedSourceGroup,
} from '../../logic/mappedRuleView'
import { staleEndpoints } from '../../logic/mappingIndex'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { filtersShowingRule } from '../../logic/ruleNavigation'
import { termLabel } from '../../logic/vocabulary'
import { useFilterStore } from '../../state/filterStore'
import { useRuleMappings } from '../../state/mappingsContext'
import { DEFAULT_AUTOMATION, DEFAULT_PAGE_SIZE, DEFAULT_VIEW_ID, parseUrlState, serializeUrlLocation } from '../../state/urlState'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { RuleRow } from '../../types/rule-row'
import { AssessmentCell, BenchmarkText } from './RuleRowCells'

export interface MappedRulesViewState {
  filter: MappedRuleFilter
  setFilter: (filter: MappedRuleFilter) => void
  openGroupKeys: ReadonlySet<string>
  toggleGroup: (groupKey: string) => void
}

// Kept by the open rule's panel rather than the tab, so switching to Details and
// back keeps the filter and the open groups, while collapsing the rule resets them.
export function useMappedRulesViewState(): MappedRulesViewState {
  const [filter, setFilter] = useState<MappedRuleFilter>({ text: '', assessment: 'all' })
  const [openGroupKeys, setOpenGroupKeys] = useState<ReadonlySet<string>>(new Set())
  function toggleGroup(groupKey: string) {
    setOpenGroupKeys((previous) => {
      const next = new Set(previous)
      if (!next.delete(groupKey)) next.add(groupKey)
      return next
    })
  }
  return { filter, setFilter, openGroupKeys, toggleGroup }
}

// What a new tab or a copied link opens: just the search and the open rule.
// A plain click keeps every filter that does not hide the rule instead.
function hrefShowing(ruleId: string): string {
  const state = { ...parseUrlState(''), view: DEFAULT_VIEW_ID, search: upstreamRuleId(ruleId), openRule: ruleId }
  return serializeUrlLocation(state, { automation: DEFAULT_AUTOMATION, size: DEFAULT_PAGE_SIZE }, import.meta.env.BASE_URL)
}

function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

const ASSESSMENT_OPTIONS: { value: AssessmentChoice; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'automated', label: 'Automated' },
  { value: 'manual', label: 'Manual' },
]

function isAssessmentChoice(value: unknown): value is AssessmentChoice {
  return ASSESSMENT_OPTIONS.some((option) => option.value === value)
}

export function MappedRulesTab({ ruleId, view }: { ruleId: string; view: MappedRulesViewState }) {
  const { byRule, rowsById } = useRuleMappings()
  const vocabularyIndex = useVocabularyIndex()
  const links = byRule.get(ruleId)
  const self = rowsById.get(ruleId)
  const groups = useMemo(
    () => groupMappedRulesBySource(links ?? [], rowsById, (sourceName) => termLabel(vocabularyIndex, 'sources', sourceName)),
    [links, rowsById, vocabularyIndex],
  )
  const { filter, setFilter } = view
  const filtering = isFilterActive(filter)
  const visibleGroups = useMemo(() => (filtering ? filterMappedRuleGroups(groups, filter) : groups), [filtering, groups, filter])
  if (!self) return null

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Input
          type="text"
          aria-label="Filter mapped rules"
          placeholder="Filter by id or title…"
          value={filter.text}
          onChange={(event) => setFilter({ ...filter, text: event.target.value })}
          className="sm:max-w-xs"
        />
        <RadioGroup
          aria-label="Assessment"
          value={filter.assessment}
          onValueChange={(value) => {
            if (isAssessmentChoice(value)) setFilter({ ...filter, assessment: value })
          }}
          className="flex w-auto flex-wrap gap-x-4 gap-y-1"
        >
          {ASSESSMENT_OPTIONS.map((option) => (
            <AssessmentOption key={option.value} value={option.value} label={option.label} />
          ))}
        </RadioGroup>
      </div>

      {visibleGroups.length === 0 ? (
        <p className="text-muted-foreground">No mapped rules match these filters.</p>
      ) : (
        <div className="space-y-2">
          {visibleGroups.map((group) => (
            <MappedSourceGroupSection
              key={group.key}
              group={group}
              self={self}
              filtering={filtering}
              isOpen={filtering || view.openGroupKeys.has(group.key)}
              onToggle={() => view.toggleGroup(group.key)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AssessmentOption({ value, label }: { value: AssessmentChoice; label: string }) {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem id={id} value={value} />
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
    </div>
  )
}

function MappedSourceGroupSection({
  group,
  self,
  filtering,
  isOpen,
  onToggle,
}: {
  group: MappedSourceGroup
  self: RuleRow
  filtering: boolean
  isOpen: boolean
  onToggle: () => void
}) {
  const vocabularyIndex = useVocabularyIndex()
  const listId = useId()
  const heading = `${termLabel(vocabularyIndex, 'sources', group.sourceName)} ${group.relationLabel}`
  const count = filtering ? `${group.items.length} of ${group.total}` : `${group.total}`
  const Chevron = isOpen ? ChevronDown : ChevronRight

  return (
    <section className="rounded-md border border-border">
      <h4>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listId : undefined}
          // The filter holds matching groups open, so a click has nothing to toggle until it is cleared.
          aria-disabled={filtering || undefined}
          onClick={filtering ? undefined : onToggle}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left font-medium hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
        >
          <Chevron className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{heading}</span>
          <span className="shrink-0 text-muted-foreground">({count})</span>
        </button>
      </h4>
      {isOpen && (
        <ul id={listId} aria-label={heading} className="divide-y divide-border border-t border-border px-3">
          {group.items.map((item) => (
            <MappedRuleRow key={item.link.rule} item={item} self={self} />
          ))}
        </ul>
      )}
    </section>
  )
}

export function MappedRuleRow({ item, self }: { item: MappedRuleItem; self: RuleRow }) {
  const { link, row } = item
  const vocabularyIndex = useVocabularyIndex()
  const showRule = useFilterStore((store) => store.showRule)
  const sourceLabel = termLabel(vocabularyIndex, 'sources', row.sourceName)
  const upstreamId = upstreamRuleId(row.ref.id)
  const title = useDisplayTitle(row)
  const stale = staleEndpoints(
    link,
    { ruleId: self.ref.id, sourceName: self.sourceName, releaseTag: self.releaseTag },
    { sourceName: row.sourceName, releaseTag: row.releaseTag },
  )

  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (!isPlainClick(event)) return
    event.preventDefault()
    showRule(row.ref.id, filtersShowingRule(row, useFilterStore.getState(), vocabularyIndex))
  }

  return (
    <li data-testid="mapped-rule" className="flex flex-col gap-1 py-2 text-xs md:flex-row md:items-start md:gap-3">
      <div className="min-w-0 break-words md:flex-1">
        <a
          href={hrefShowing(row.ref.id)}
          onClick={navigate}
          aria-label={`Show ${sourceLabel} ${upstreamId}: ${title}`}
          className="text-sm text-link underline underline-offset-4 hover:no-underline"
        >
          {title}
        </a>
        <p className="font-mono break-all text-muted-foreground">{upstreamId}</p>
        {link.note && <p className="text-muted-foreground">{link.note}</p>}
        {stale.map((endpoint) => (
          <p key={endpoint.ruleId} data-testid="stale-mapping-note" className="text-warning-foreground">
            This link was checked against {termLabel(vocabularyIndex, 'sources', endpoint.sourceName)} {endpoint.mappedRelease} for{' '}
            {upstreamRuleId(endpoint.ruleId)}, which is now from {endpoint.currentRelease}. Review it for accuracy.
          </p>
        ))}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 md:contents">
        <div className="md:w-52 md:shrink-0">
          <AssessmentCell row={row} />
        </div>
        <div className="max-w-full min-w-0 md:w-44 md:shrink-0">
          <BenchmarkText row={row} />
        </div>
      </div>
    </li>
  )
}
