import { useId, type ReactNode } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { KIND_LABELS } from '../../logic/changeLabels'
import type { ComparisonFacetCounts } from '../../logic/comparisonFilters'
import type { HistoryIndex } from '../../logic/historyIndex'
import { CHANGE_KINDS, type ChangeKind } from '../../logic/ruleChanges'
import { termLabel } from '../../logic/vocabulary'
import { useFilterStore } from '../../state/filterStore'
import type { CompareOnly } from '../../state/urlState'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { ManifestSource } from '../../types/library'

const SELECT_CLASS = 'h-8 w-full rounded-md border border-control-border bg-background px-2 text-sm'

function Group({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <div className="mb-4">
      <h2 id={headingId} className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      <div role="group" aria-labelledby={headingId}>
        {children}
      </div>
    </div>
  )
}

function Option({ label, count, checked, disabled, onChange }: { label: string; count?: number; checked: boolean; disabled?: boolean; onChange: () => void }) {
  const id = useId()
  return (
    <div className="flex items-start gap-2 py-0.5">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      <div className="min-w-0 text-sm leading-4 break-words">
        <Label htmlFor={id} className="inline text-sm leading-4 font-normal">
          {label}
        </Label>
        {count !== undefined && (
          <>
            {' '}
            <span aria-hidden="true" className="text-sm font-normal text-muted-foreground">
              ({count})
            </span>
          </>
        )}
      </div>
    </div>
  )
}

function LabelledSelect({ label, value, onChange, children, disabled }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="mb-2">
      <Label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">
        {label}
      </Label>
      <select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={SELECT_CLASS}>
        {children}
      </select>
    </div>
  )
}

// The comparison's own filters: which releases, which kinds of change, which
// rules. Mirrors the Rules view's sidebar (same width, same collapse below md).
export function ComparisonSidebar({
  sources,
  source,
  history,
  fromTag,
  toTag,
  kinds,
  counts,
  sections,
  benchmarks,
  only,
}: {
  sources: ManifestSource[]
  source: ManifestSource
  history: HistoryIndex
  fromTag: string
  toTag: string
  kinds: ReadonlySet<ChangeKind>
  counts: ComparisonFacetCounts
  sections: string[]
  benchmarks: string[]
  only: CompareOnly[]
}) {
  const vocabularyIndex = useVocabularyIndex()
  const showComparison = useFilterStore((state) => state.showComparison)
  const setCompareReleases = useFilterStore((state) => state.setCompareReleases)
  const setChangeKinds = useFilterStore((state) => state.setChangeKinds)
  const toggleSection = useFilterStore((state) => state.toggleCompareSection)
  const toggleBenchmark = useFilterStore((state) => state.toggleCompareBenchmark)
  const toggleOnly = useFilterStore((state) => state.toggleCompareOnly)

  const fromPosition = history.releases.findIndex((release) => release.tag === fromTag)
  const laterReleases = history.releases.filter((_, position) => position > fromPosition)

  function changeFramework(name: string) {
    const next = sources.find((candidate) => candidate.name === name)
    if (next === undefined || next.releases.length < 2) return
    showComparison(name, next.releases[next.releases.length - 2].tag, next.releases[next.releases.length - 1].tag)
  }

  function changeFrom(tag: string) {
    const position = history.releases.findIndex((release) => release.tag === tag)
    const toStillLater = history.releases.findIndex((release) => release.tag === toTag) > position
    setCompareReleases(tag, toStillLater ? toTag : history.releases[history.releases.length - 1].tag)
  }

  function toggleKind(kind: ChangeKind) {
    const next = kinds.has(kind) ? CHANGE_KINDS.filter((candidate) => kinds.has(candidate) && candidate !== kind) : CHANGE_KINDS.filter((candidate) => kinds.has(candidate) || candidate === kind)
    if (next.length > 0) setChangeKinds(next)
  }

  const sectionOptions = [...new Set([...counts.sections.keys(), ...sections])].sort((left, right) =>
    termLabel(vocabularyIndex, 'sections', left).localeCompare(termLabel(vocabularyIndex, 'sections', right), 'en'),
  )
  const benchmarkOptions = [...new Set([...counts.benchmarks.keys(), ...benchmarks])].sort((left, right) =>
    termLabel(vocabularyIndex, 'benchmarks', left).localeCompare(termLabel(vocabularyIndex, 'benchmarks', right), 'en'),
  )

  return (
    <aside className="flex max-h-64 w-full flex-col border-b border-border text-sm md:max-h-none md:w-64 md:shrink-0 md:border-r md:border-b-0">
      <div data-testid="comparison-sidebar-scroll-area" className="min-h-0 flex-1 overflow-y-auto p-4">
        <Group title="Releases">
          <LabelledSelect label="Framework" value={source.name} onChange={changeFramework}>
            {sources
              .filter((candidate) => candidate.releases.length > 1)
              .map((candidate) => (
                <option key={candidate.name} value={candidate.name}>
                  {candidate.display_name}
                </option>
              ))}
          </LabelledSelect>
          <LabelledSelect label="From" value={fromTag} onChange={changeFrom}>
            {history.releases.slice(0, -1).map((release) => (
              <option key={release.tag} value={release.tag}>
                {release.label}
              </option>
            ))}
          </LabelledSelect>
          <LabelledSelect label="To" value={toTag} onChange={(tag) => setCompareReleases(fromTag, tag)}>
            {laterReleases.map((release) => (
              <option key={release.tag} value={release.tag}>
                {release.label}
              </option>
            ))}
          </LabelledSelect>
        </Group>

        <Group title="Kind of change">
          {CHANGE_KINDS.map((kind) => (
            <Option key={kind} label={KIND_LABELS[kind]} count={counts.kinds[kind]} checked={kinds.has(kind)} disabled={kinds.has(kind) && kinds.size === 1} onChange={() => toggleKind(kind)} />
          ))}
        </Group>

        <Group title="Only rules that…">
          <Option label="have my custom changes" checked={only.includes('custom')} onChange={() => toggleOnly('custom')} />
          <Option label="are in my selection" checked={only.includes('selected')} onChange={() => toggleOnly('selected')} />
        </Group>

        <Group title="Section">
          {sectionOptions.map((section) => (
            <Option key={section} label={termLabel(vocabularyIndex, 'sections', section)} count={counts.sections.get(section) ?? 0} checked={sections.includes(section)} onChange={() => toggleSection(section)} />
          ))}
        </Group>

        <Group title="Benchmark">
          {benchmarkOptions.map((benchmark) => (
            <Option key={benchmark} label={termLabel(vocabularyIndex, 'benchmarks', benchmark)} count={counts.benchmarks.get(benchmark) ?? 0} checked={benchmarks.includes(benchmark)} onChange={() => toggleBenchmark(benchmark)} />
          ))}
        </Group>
      </div>
    </aside>
  )
}
