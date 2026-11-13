import { ArrowUpRight } from 'lucide-react'
import { useId, type MouseEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useDisplayTitle } from '../../hooks/useDisplayTitle'
import { groupCaption, relationBadgeLabel, type MappedRuleItem, type MappedSourceGroup, type MappingGroupRelation } from '../../logic/mappedRuleView'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { filtersShowingRule } from '../../logic/ruleNavigation'
import { termLabel } from '../../logic/vocabulary'
import { useFilterStore } from '../../state/filterStore'
import type { MappedRulesViewState } from '../../state/mappedRulesView'
import { useRuleMappings } from '../../state/mappingsContext'
import { DEFAULT_AUTOMATION, DEFAULT_PAGE_SIZE, DEFAULT_VIEW_ID, parseUrlState, serializeUrlLocation } from '../../state/urlState'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { RuleRow } from '../../types/rule-row'
import { MappingProvenance } from '../mappings/MappingProvenance'
import { MappedRuleSummary } from './MappedRuleSummary'
import { MappingPathHops } from './MappingPathHops'
import { RuleDetailPanel } from './RuleDetailPanel'
import { AssessmentCell, BenchmarkText } from './RuleRowCells'
import { StaleLinkNotes } from './StaleLinkNotes'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'

// What a new tab or a copied link opens: just the search and the open rule.
// A plain click keeps every filter that does not hide the rule instead.
function hrefShowing(ruleId: string): string {
  const state = { ...parseUrlState(''), view: DEFAULT_VIEW_ID, search: upstreamRuleId(ruleId), openRule: ruleId }
  return serializeUrlLocation(state, { automation: DEFAULT_AUTOMATION, size: DEFAULT_PAGE_SIZE }, import.meta.env.BASE_URL)
}

function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

const RELATION_BADGE_VARIANTS: Record<MappingGroupRelation, 'default' | 'secondary' | 'outline'> = {
  supports: 'default',
  'supported-by': 'secondary',
  related: 'outline',
}

const MAXIMUM_NAMED_ALSO_THROUGH = 3

function alsoThroughText(ruleLabels: string[]): string {
  const named = ruleLabels.slice(0, MAXIMUM_NAMED_ALSO_THROUGH)
  const remaining = ruleLabels.length - named.length
  const list = remaining === 0 ? named.join(', ') : `${named.join(', ')} and ${remaining} more`
  return `Also through ${list}`
}

export type GroupHeadingLevel = 3 | 4 | 5 | 6

export function MappedSourceGroupSection({
  group,
  self,
  filtering,
  isOpen,
  onToggle,
  view,
  headingLevel,
  throughLabel,
}: {
  group: MappedSourceGroup
  self: RuleRow
  filtering: boolean
  isOpen: boolean
  onToggle: () => void
  view: MappedRulesViewState
  headingLevel: GroupHeadingLevel
  // Indirect groups only: the rules the path runs through, as short ids.
  throughLabel?: string
}) {
  const vocabularyIndex = useVocabularyIndex()
  const listId = useId()
  const captionId = useId()
  const sourceLabel = termLabel(vocabularyIndex, 'sources', group.sourceName)
  const relationLabel = relationBadgeLabel(group.relation, group.indirect)
  const count = filtering ? `${group.items.length} of ${group.total}` : `${group.total}`
  const Heading = `h${headingLevel}` as const
  const baseCaption = groupCaption(group.relation, group.indirect)
  const caption = throughLabel === undefined ? baseCaption : `${baseCaption} Through ${throughLabel}.`
  const listName = throughLabel === undefined ? `${relationLabel}: ${sourceLabel}` : `${relationLabel}, through ${throughLabel}: ${sourceLabel}`

  return (
    <section className="rounded-lg border border-border">
      <Heading>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listId : undefined}
          // The filter holds matching groups open, so a click has nothing to toggle until it is cleared.
          aria-disabled={filtering || undefined}
          onClick={filtering ? undefined : onToggle}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left font-medium hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
        >
          <DisclosureChevron isOpen={isOpen} />
          <Badge variant={RELATION_BADGE_VARIANTS[group.relation]} className={group.indirect ? 'h-auto border-dashed whitespace-normal' : undefined}>
            {relationLabel}
          </Badge>
          <span className="min-w-0 break-words">{sourceLabel}</span>
          <span className="shrink-0 text-muted-foreground">({count})</span>
        </button>
      </Heading>
      {isOpen && (
        <div className="border-t border-border">
          <p id={captionId} className="px-3 pt-2 text-xs text-muted-foreground">{caption}</p>
          <ul id={listId} aria-describedby={captionId} aria-label={listName} className="divide-y divide-border px-3">
            {group.items.map((item) => (
              <MappedRuleRow
                key={item.link.rule}
                item={item}
                self={self}
                isExpanded={view.expandedRuleIds.has(item.row.ref.id)}
                onToggle={() => view.toggleRule(item.row.ref.id)}
                isHopListOpen={view.openHopListRuleIds.has(item.row.ref.id)}
                onToggleHopList={() => view.toggleHopList(item.row.ref.id)}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export function MappedRuleRow({
  item,
  self,
  isExpanded,
  onToggle,
  isHopListOpen,
  onToggleHopList,
}: {
  item: MappedRuleItem
  self: RuleRow
  isExpanded: boolean
  onToggle: () => void
  isHopListOpen: boolean
  onToggleHopList: () => void
}) {
  const { link, row, indirect } = item
  const { rowsById } = useRuleMappings()
  const vocabularyIndex = useVocabularyIndex()
  const showRule = useFilterStore((store) => store.showRule)
  const detailsId = useId()
  const hopListId = useId()
  const sourceLabel = termLabel(vocabularyIndex, 'sources', row.sourceName)
  const upstreamId = upstreamRuleId(row.ref.id)
  const title = useDisplayTitle(row)
  const lastHop = indirect?.path[indirect.path.length - 1]
  // An indirect link's stale notes are judged against the rule just before this one on the path, not the open rule.
  const linkedFromRow = (lastHop === undefined ? undefined : rowsById.get(lastHop.fromRuleId)) ?? self

  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (!isPlainClick(event)) return
    event.preventDefault()
    showRule(row.ref.id, filtersShowingRule(row, useFilterStore.getState(), vocabularyIndex))
  }

  return (
    <li data-testid="mapped-rule" className="py-2 text-xs">
      <div
        className="flex cursor-pointer flex-col gap-1 md:flex-row md:items-start md:gap-3"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('input, a, button, ol')) return
          onToggle()
        }}
      >
        <div className="min-w-0 break-words md:flex-1">
          <Tooltip>
            <TooltipTrigger
              render={<button type="button" />}
              aria-expanded={isExpanded}
              aria-controls={isExpanded ? detailsId : undefined}
              aria-label={`${sourceLabel} ${upstreamId}: ${title}`}
              onClick={onToggle}
              className="rounded-sm text-left text-sm text-link underline underline-offset-4 hover:no-underline focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
            >
              {title}
            </TooltipTrigger>
            <TooltipContent className="bg-popover text-popover-foreground ring-1 ring-border dark:bg-popover dark:text-popover-foreground dark:ring-border">
              <MappedRuleSummary row={row} />
            </TooltipContent>
          </Tooltip>
          <p className="font-mono break-all text-muted-foreground">{upstreamId}</p>
          <MappingProvenance mapping={link.mapping} note={link.note || null} />
          <StaleLinkNotes link={link} fromRow={linkedFromRow} toRow={row} />
          {indirect !== undefined && (
            <>
              {indirect.alsoThroughRuleIds.length > 0 && (
                <p className="break-words text-muted-foreground">{alsoThroughText(indirect.alsoThroughRuleIds.map(upstreamRuleId))}</p>
              )}
              <button
                type="button"
                aria-expanded={isHopListOpen}
                aria-controls={isHopListOpen ? hopListId : undefined}
                onClick={onToggleHopList}
                className="mt-1 flex items-center gap-1 rounded-sm text-left text-link underline underline-offset-4 hover:no-underline focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
              >
                <DisclosureChevron isOpen={isHopListOpen} className="size-3" />
                How this is linked
              </button>
              {isHopListOpen && <MappingPathHops id={hopListId} path={indirect.path} />}
            </>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 md:contents">
          <div className="md:w-52 md:shrink-0">
            <AssessmentCell row={row} />
          </div>
          <div className="max-w-full min-w-0 md:w-44 md:shrink-0">
            <BenchmarkText row={row} />
          </div>
        </div>
      </div>
      {isExpanded && (
        <div id={detailsId} className="mt-2 overflow-hidden rounded-lg border border-border">
          <div className="flex justify-end border-b border-border bg-panel px-4 py-2">
            <a href={hrefShowing(row.ref.id)} onClick={navigate} className={buttonVariants({ variant: 'outline', size: 'xs' })}>
              Go to this rule
              <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
            </a>
          </div>
          <RuleDetailPanel ruleRef={row.ref} nested />
        </div>
      )}
    </li>
  )
}
