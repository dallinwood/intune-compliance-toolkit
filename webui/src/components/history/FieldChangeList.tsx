import { changeLabel, visibleChanges } from '../../logic/changeLabels'
import type { ChangeKind, FieldChange } from '../../logic/ruleChanges'
import { diffLines, diffWords } from '../../logic/sequenceDiff'
import { useVocabularyIndex } from '../../state/vocabularyContext'

const REMOVED_CLASSES = 'bg-diff-removed text-diff-removed-foreground'
const ADDED_CLASSES = 'bg-diff-added text-diff-added-foreground'

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// Removed words are struck through and added ones underlined, so the change
// does not rest on colour alone.
function TextDiff({ before, after }: { before: unknown; after: unknown }) {
  return (
    <p className="text-sm break-words whitespace-pre-wrap">
      {diffWords(asText(before), asText(after)).map((operation, position) => {
        const text = operation.items.join('')
        if (operation.type === 'removed') {
          return (
            <del key={position} className={`${REMOVED_CLASSES} rounded-sm px-0.5`}>
              {text}
            </del>
          )
        }
        if (operation.type === 'added') {
          return (
            <ins key={position} className={`${ADDED_CLASSES} rounded-sm px-0.5 underline decoration-dotted`}>
              {text}
            </ins>
          )
        }
        return <span key={position}>{text}</span>
      })}
    </p>
  )
}

const LINE_CLASSES = {
  same: 'text-slate-300',
  removed: 'bg-red-500/25 text-red-100',
  added: 'bg-green-500/25 text-green-100',
} as const
const GUTTERS = { same: ' ', removed: '-', added: '+' } as const

// The same dark block as a script elsewhere in the panel, with a - or + in
// the gutter of every changed line.
function CodeDiff({ before, after }: { before: unknown; after: unknown }) {
  return (
    <pre className="max-w-full overflow-x-auto rounded bg-slate-900 py-2 font-mono text-xs dark:ring-1 dark:ring-white/10">
      <code>
        {diffLines(asText(before), asText(after)).flatMap((operation, operationPosition) =>
          operation.items.map((line, linePosition) => (
            <span key={`${operationPosition}-${linePosition}`} data-diff-line={operation.type} className={`flex px-2 ${LINE_CLASSES[operation.type]}`}>
              <span aria-hidden="true" className="w-4 shrink-0 select-none">
                {GUTTERS[operation.type]}
              </span>
              <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{line === '' ? ' ' : line}</span>
            </span>
          )),
        )}
      </code>
    </pre>
  )
}

function itemsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function ListDiff({ before, after }: { before: unknown; after: unknown }) {
  const beforeItems = itemsOf(before)
  const afterItems = itemsOf(after)
  const added = afterItems.filter((item) => !beforeItems.includes(item))
  const removed = beforeItems.filter((item) => !afterItems.includes(item))
  if (added.length === 0 && removed.length === 0) return <p className="text-sm text-muted-foreground">Only the order changed.</p>
  return (
    <ul className="flex flex-wrap gap-1.5">
      {added.map((item) => (
        <li key={`added-${item}`} className={`${ADDED_CLASSES} rounded-full px-2 py-0.5 text-xs`}>
          <span aria-hidden="true">+ </span>
          <span className="sr-only">Added: </span>
          {item}
        </li>
      ))}
      {removed.map((item) => (
        <li key={`removed-${item}`} className={`${REMOVED_CLASSES} rounded-full px-2 py-0.5 text-xs line-through`}>
          <span className="sr-only">Removed: </span>
          {item}
        </li>
      ))}
    </ul>
  )
}

function formatValue(value: unknown): string {
  if (value === undefined) return '(not present)'
  if (value === null) return 'none'
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
}

function ValueDiff({ before, after }: { before: unknown; after: unknown }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Before</dt>
      <dd className={`${REMOVED_CLASSES} rounded-sm px-1 font-mono text-xs break-words whitespace-pre-wrap`}>{formatValue(before)}</dd>
      <dt className="text-muted-foreground">After</dt>
      <dd className={`${ADDED_CLASSES} rounded-sm px-1 font-mono text-xs break-words whitespace-pre-wrap`}>{formatValue(after)}</dd>
    </dl>
  )
}

function ChangeBody({ change }: { change: FieldChange }) {
  if (change.display === 'text') return <TextDiff before={change.before} after={change.after} />
  if (change.display === 'code') return <CodeDiff before={change.before} after={change.after} />
  if (change.display === 'list') return <ListDiff before={change.before} after={change.after} />
  return <ValueDiff before={change.before} after={change.after} />
}

// One row per changed field: what changed on the left, the change on the
// right (stacked below the sm breakpoint). A row carries no kind tag: it is
// always drawn under a header that lists the kinds of change.
export function FieldChangeList({
  changes,
  kinds,
  focusPaths,
}: {
  changes: FieldChange[]
  kinds?: ReadonlySet<ChangeKind>
  focusPaths?: string[][]
}) {
  const vocabularyIndex = useVocabularyIndex()
  const shown = visibleChanges(changes, kinds, focusPaths)
  if (shown.length === 0) return <p className="text-sm text-muted-foreground">No changes to show.</p>
  return (
    <ul className="divide-y divide-border">
      {shown.map((change) => (
        <li key={change.path.join('\u0000')} data-testid="field-change" className="flex flex-col gap-1.5 py-2 sm:flex-row sm:gap-4">
          <span className="shrink-0 text-sm font-medium break-words sm:w-52">{changeLabel(change.path, vocabularyIndex)}</span>
          <div className="min-w-0 sm:flex-1">
            <ChangeBody change={change} />
          </div>
        </li>
      ))}
    </ul>
  )
}
