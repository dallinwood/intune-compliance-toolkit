import { useId, useState } from 'react'
import { KIND_LABELS, quietEntryText, quietRunSummary, startingPointText, timelineStateText } from '../../logic/changeLabels'
import {
  foldQuietRuns,
  previousTagWithRule,
  type HistoryIndex,
  type TimelineEntry,
  type TimelineItem,
} from '../../logic/historyIndex'
import { CHANGE_KINDS, effectiveKinds, type ChangeKind } from '../../logic/ruleChanges'
import { ToggleButtons } from '../rules/DisclosureButtons'
import { ChangesBetween } from './ChangesBetween'
import { KindTag } from './KindTag'
import { NativeSelect } from '@/components/ui/native-select'

export interface HistoryCompare {
  from: string
  to: string
  focusPaths?: string[][]
}

const KIND_PILLS = CHANGE_KINDS.map((kind) => ({ key: kind, label: KIND_LABELS[kind] }))

const CARD_BUTTON_CLASS =
  'flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none'

function hasChange(entry: TimelineEntry): boolean {
  return entry.state === 'added' || entry.state === 'changed' || entry.state === 'removed'
}

function labelOfTag(index: HistoryIndex, tag: string): string {
  return index.releases.find((release) => release.tag === tag)?.label ?? tag
}

function ReleaseCard({
  entry,
  index,
  ruleId,
  isOpen,
  onToggle,
  kinds,
}: {
  entry: TimelineEntry
  index: HistoryIndex
  ruleId: string
  isOpen: boolean
  onToggle: () => void
  kinds: ReadonlySet<ChangeKind>
}) {
  const bodyId = useId()
  const stateText = timelineStateText(entry)
  const previousTag = previousTagWithRule(index, ruleId, entry.tag)
  return (
    <li data-testid="history-card" className="rounded-md border border-border">
      <button type="button" aria-expanded={isOpen} aria-controls={isOpen ? bodyId : undefined} onClick={onToggle} className={CARD_BUTTON_CLASS}>
        <span className="font-medium">{entry.label}</span>
        <span className="font-mono text-xs text-muted-foreground">{entry.tag}</span>
        {entry.kinds.map((kind) => (
          <KindTag key={kind} kind={kind} />
        ))}
        {stateText !== null && <span className="text-muted-foreground">{stateText}</span>}
      </button>
      {isOpen && (
        <div id={bodyId} className="border-t border-border px-3 py-2">
          {entry.state === 'changed' && previousTag !== null && (
            <ChangesBetween index={index} ruleId={ruleId} fromTag={previousTag} toTag={entry.tag} kinds={kinds} />
          )}
          {entry.state === 'added' && <p className="text-sm text-muted-foreground">This rule was added in {entry.label}.</p>}
          {entry.state === 'removed' && <p className="text-sm text-muted-foreground">This rule is no longer in {entry.label}.</p>}
        </div>
      )}
    </li>
  )
}

// The oldest release kept is where the history starts, not a change, so it is
// a marker in the quiet bar's style instead of a card.
function StartingPoint({ entry }: { entry: TimelineEntry }) {
  return (
    <li data-testid="history-starting-point" className="flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-hidden="true" className="h-px flex-1 border-t border-dashed border-border" />
      <span>{startingPointText(entry)}</span>
      <span aria-hidden="true" className="h-px flex-1 border-t border-dashed border-border" />
    </li>
  )
}

function QuietBar({
  entries,
  kinds,
  isExpanded,
  onToggle,
}: {
  entries: TimelineEntry[]
  kinds: ReadonlySet<ChangeKind>
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <li data-testid="history-quiet-run">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden="true" className="h-px flex-1 border-t border-dashed border-border" />
        <span>{quietRunSummary(entries, kinds)}</span>
        <button type="button" aria-expanded={isExpanded} onClick={onToggle} className="rounded-sm text-link underline focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none">
          {isExpanded ? 'hide' : 'show'}
        </button>
        <span aria-hidden="true" className="h-px flex-1 border-t border-dashed border-border" />
      </div>
      {isExpanded && (
        <ul className="mt-1 space-y-1">
          {entries.map((entry) => (
            <li key={entry.tag} className="rounded-md px-3 py-1 text-sm text-muted-foreground">
              {entry.label} <span className="font-mono text-xs">{entry.tag}</span> - {quietEntryText(entry, kinds)}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function CompareSection({
  index,
  ruleId,
  fromTag,
  toTag,
  onFromChange,
  onToChange,
  kinds,
  focusPaths,
}: {
  index: HistoryIndex
  ruleId: string
  fromTag: string
  toTag: string
  onFromChange: (tag: string) => void
  onToChange: (tag: string) => void
  kinds: ReadonlySet<ChangeKind> | undefined
  focusPaths?: string[][]
}) {
  const fromId = useId()
  const toId = useId()
  const fromPosition = index.releases.findIndex((release) => release.tag === fromTag)
  const toOptions = index.releases.filter((_, position) => position > fromPosition)
  const versions = index.rules[ruleId]?.versions ?? []
  const missingIn = [fromTag, toTag].filter((tag) => tag !== '' && versions[index.releases.findIndex((release) => release.tag === tag)] === null)
  return (
    <section aria-label="Compare any two releases" className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-medium">Compare any two</span>
        <label htmlFor={fromId} className="text-sm text-muted-foreground">
          From
        </label>
        <NativeSelect id={fromId} value={fromTag} onChange={(event) => onFromChange(event.target.value)}>
          <option value="">Choose a release</option>
          {index.releases.slice(0, -1).map((release) => (
            <option key={release.tag} value={release.tag}>
              {release.label}
            </option>
          ))}
        </NativeSelect>
        <label htmlFor={toId} className="text-sm text-muted-foreground">
          To
        </label>
        <NativeSelect id={toId} value={toTag} disabled={fromTag === ''} onChange={(event) => onToChange(event.target.value)}>
          <option value="">Choose a release</option>
          {toOptions.map((release) => (
            <option key={release.tag} value={release.tag}>
              {release.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      {fromTag !== '' && toTag !== '' && (
        <div data-testid="history-compare-result" className="rounded-md border border-border px-3 py-2">
          {missingIn.length > 0 ? (
            <p className="text-sm text-muted-foreground">This rule is not in {missingIn.map((tag) => labelOfTag(index, tag)).join(' or ')}, so there is nothing to compare.</p>
          ) : (
            <ChangesBetween index={index} ruleId={ruleId} fromTag={fromTag} toTag={toTag} kinds={kinds} focusPaths={focusPaths} />
          )}
        </div>
      )}
    </section>
  )
}

export function RuleHistoryTab({
  ruleId,
  index,
  timeline,
  initialCompare,
}: {
  ruleId: string
  index: HistoryIndex
  timeline: TimelineEntry[]
  initialCompare?: HistoryCompare
}) {
  // All on to start; none on also shows every kind, as the Rules view's filters do.
  const [selectedKinds, setSelectedKinds] = useState<ReadonlySet<ChangeKind>>(new Set(CHANGE_KINDS))
  const shownKinds = effectiveKinds([...selectedKinds])
  const [fromTag, setFromTag] = useState(initialCompare?.from ?? '')
  const [toTag, setToTag] = useState(initialCompare?.to ?? '')
  const newestChange = timeline.find(hasChange)
  const [openTags, setOpenTags] = useState<ReadonlySet<string>>(new Set(newestChange === undefined ? [] : [newestChange.tag]))
  const [expandedRuns, setExpandedRuns] = useState<ReadonlySet<string>>(new Set())
  const items = foldQuietRuns(timeline, shownKinds)

  function toggle(current: ReadonlySet<string>, key: string): ReadonlySet<string> {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  function changeFrom(tag: string) {
    setFromTag(tag)
    const fromPosition = index.releases.findIndex((release) => release.tag === tag)
    const toPosition = index.releases.findIndex((release) => release.tag === toTag)
    if (tag === '' || toPosition <= fromPosition) setToTag('')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-medium">Show</span>
        <ToggleButtons
          items={KIND_PILLS}
          pressedKeys={selectedKinds}
          ariaLabel="Kinds of change to show"
          onToggle={(key) => setSelectedKinds((current) => toggle(current, key) as ReadonlySet<ChangeKind>)}
        />
        {selectedKinds.size === 0 && <span className="text-xs text-muted-foreground">Showing all kinds</span>}
        {selectedKinds.size > 0 && selectedKinds.size < CHANGE_KINDS.length && (
          <button
            type="button"
            onClick={() => setSelectedKinds(new Set(CHANGE_KINDS))}
            className="rounded-sm text-xs text-link underline focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
          >
            Show all
          </button>
        )}
      </div>

      <CompareSection
        index={index}
        ruleId={ruleId}
        fromTag={fromTag}
        toTag={toTag}
        onFromChange={changeFrom}
        onToChange={setToTag}
        kinds={shownKinds}
        focusPaths={initialCompare?.focusPaths}
      />

      <ol className="space-y-2">
        {items.map((item: TimelineItem) =>
          item.type === 'entry' && item.entry.state === 'earliest' ? (
            <StartingPoint key={item.entry.tag} entry={item.entry} />
          ) : item.type === 'entry' ? (
            <ReleaseCard
              key={item.entry.tag}
              entry={item.entry}
              index={index}
              ruleId={ruleId}
              isOpen={openTags.has(item.entry.tag)}
              onToggle={() => setOpenTags((current) => toggle(current, item.entry.tag))}
              kinds={shownKinds}
            />
          ) : (
            <QuietBar
              key={item.entries[0].tag}
              entries={item.entries}
              kinds={shownKinds}
              isExpanded={expandedRuns.has(item.entries[0].tag)}
              onToggle={() => setExpandedRuns((current) => toggle(current, item.entries[0].tag))}
            />
          ),
        )}
      </ol>
    </div>
  )
}
