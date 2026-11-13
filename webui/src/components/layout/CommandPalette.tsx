import { Autocomplete } from '@base-ui/react/autocomplete'
import { SearchIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildPaletteEntries,
  isApplePlatform,
  isPaletteShortcut,
  resultStatus,
  searchPalette,
  type PaletteEntry,
} from '../../logic/commandPalette'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { termLabel } from '../../logic/vocabulary'
import { useFilterStore } from '../../state/filterStore'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { ManifestSource } from '../../types/library'
import type { RuleRow } from '../../types/rule-row'
import { VIEWS } from '../../views/viewRegistry'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../ui/dialog'
import { Badge } from '@/components/ui/badge'

const PALETTE_DESCRIPTION = 'Search rules, frameworks and views'
const INPUT_PLACEHOLDER = 'Search rules, frameworks and views…'

interface PaletteGroup {
  value: string
  items: PaletteEntry[]
}

function otherDialogIsOpen(): boolean {
  return document.querySelector('[data-slot="dialog-content"]:not([data-command-palette])') !== null
}

function shortcutHint(): string {
  return isApplePlatform(navigator.platform, navigator.userAgent) ? '⌘ K' : 'Ctrl K'
}

function entryText(entry: PaletteEntry): string {
  return entry.kind === 'rule' ? entry.title : entry.label
}

function PaletteItemContent({ entry }: { entry: PaletteEntry }) {
  if (entry.kind === 'rule') {
    return (
      <>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-xs break-all text-muted-foreground">{entry.upstreamId}</span>
          <span className="line-clamp-2 text-sm">{entry.title}</span>
        </span>
        <Badge variant="outline" className="text-muted-foreground">
          {entry.sourceLabel}
        </Badge>
      </>
    )
  }
  return (
    <>
      <span className="min-w-0 flex-1 text-sm">{entry.label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{entry.kind === 'view' ? 'View' : 'Framework'}</span>
    </>
  )
}

export function CommandPalette({
  rows,
  sources,
  onNavigate,
}: {
  rows: RuleRow[]
  sources: ManifestSource[]
  onNavigate: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const vocabularyIndex = useVocabularyIndex()
  const setView = useFilterStore((state) => state.setView)
  const showComparison = useFilterStore((state) => state.showComparison)
  const showRuleFromComparison = useFilterStore((state) => state.showRuleFromComparison)

  const entries = useMemo(
    () =>
      buildPaletteEntries(VIEWS, sources, rows, (sourceName) => termLabel(vocabularyIndex, 'sources', sourceName)),
    [rows, sources, vocabularyIndex],
  )
  const results = searchPalette(entries, query)
  const groups: PaletteGroup[] = [
    { value: 'Views', items: results.views },
    { value: 'Frameworks', items: results.frameworks },
    { value: 'Rules', items: results.rules },
  ].filter((group) => group.items.length > 0)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isPaletteShortcut(event) || otherDialogIsOpen()) return
      event.preventDefault()
      setIsOpen((wasOpen) => !wasOpen)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (!isOpen) setQuery('')
  }, [isOpen])

  function activate(entry: PaletteEntry) {
    setIsOpen(false)
    onNavigate()
    if (entry.kind === 'view') setView(entry.viewId)
    else if (entry.kind === 'framework') showComparison(entry.sourceName, null, null)
    else showRuleFromComparison(entry.ruleId, upstreamRuleId(entry.ruleId), null)
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger
        aria-keyshortcuts="Control+K Meta+K"
        className="inline-flex items-center gap-2 rounded-md border border-control-border px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
      >
        <SearchIcon className="size-4" aria-hidden="true" />
        Search
        <kbd className="hidden rounded border border-border px-1.5 font-sans text-xs sm:inline">{shortcutHint()}</kbd>
      </DialogTrigger>
      <DialogContent data-command-palette="" initialFocus={inputRef} className="top-[10vh] max-w-xl translate-y-0">
        <DialogTitle className="sr-only">Go to</DialogTitle>
        <DialogDescription className="sr-only">{PALETTE_DESCRIPTION}</DialogDescription>
        <Autocomplete.Root
          inline
          open
          autoHighlight
          filter={null}
          items={groups}
          value={query}
          onValueChange={setQuery}
          itemToStringValue={entryText}
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Autocomplete.Input
              ref={inputRef}
              aria-label={PALETTE_DESCRIPTION}
              placeholder={INPUT_PLACEHOLDER}
              className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
            />
            <DialogClose
              aria-label="Close"
              className="rounded-sm px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
            >
              Esc
            </DialogClose>
          </div>
          <Autocomplete.Status className="px-3 py-1.5 text-xs text-muted-foreground">
            {resultStatus(results)}
          </Autocomplete.Status>
          <Autocomplete.List className="max-h-[60dvh] overflow-y-auto px-2 pb-2">
            {(group: PaletteGroup) => (
              <Autocomplete.Group key={group.value} items={group.items}>
                <Autocomplete.GroupLabel className="px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground">
                  {group.value}
                </Autocomplete.GroupLabel>
                <Autocomplete.Collection>
                  {(entry: PaletteEntry) => (
                    <Autocomplete.Item
                      key={entry.key}
                      value={entry}
                      onClick={() => activate(entry)}
                      className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                    >
                      <PaletteItemContent entry={entry} />
                    </Autocomplete.Item>
                  )}
                </Autocomplete.Collection>
              </Autocomplete.Group>
            )}
          </Autocomplete.List>
        </Autocomplete.Root>
      </DialogContent>
    </Dialog>
  )
}
