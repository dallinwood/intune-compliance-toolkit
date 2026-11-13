import { useId, type ReactNode } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { FacetGroup } from '../filters/FacetGroup'
import { KIND_LABELS } from '../../logic/changeLabels'
import { toggledKindSelection, type ComparisonFacetCounts } from '../../logic/comparisonFilters'
import type { HistoryIndex } from '../../logic/historyIndex'
import { EMPTY_RELEASE_LABEL, EMPTY_RELEASE_TAG, isEmptyRelease, resolveComparisonRange } from '../../logic/releaseRange'
import { CHANGE_KINDS, type ChangeKind } from '../../logic/ruleChanges'
import { termLabel } from '../../logic/vocabulary'
import { useFilterStore } from '../../state/filterStore'
import type { CompareOnly } from '../../state/urlState'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { ManifestSource } from '../../types/library'
import { formatCount } from '../../lib/format'
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
              ({formatCount(count)})
            </span>
          </>
        )}
      </div>
    </div>
  )
}

// Nothing ticked shows every kind; a partial selection offers a way back to all of them.
function KindsNote({ selectedCount, onShowAll }: { selectedCount: number; onShowAll: () => void }) {
  if (selectedCount === 0) return <p className="mt-1 text-xs text-muted-foreground">Showing all kinds</p>
  if (selectedCount === CHANGE_KINDS.length) return null
  return (
    <button type="button" onClick={onShowAll} className="mt-1 rounded-sm text-xs text-link underline focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none">
      Show all
    </button>
  )
}

function LabelledSelect({ label, value, onChange, children, disabled }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="mb-2">
      <Label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">
        {label}
      </Label>
      <NativeSelect id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="w-full">
        {children}
      </NativeSelect>
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
  selectedKinds,
  customisedUnavailable,
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
  selectedKinds: ChangeKind[] | null
  customisedUnavailable: boolean
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

  const releaseTags = history.releases.map((release) => release.tag)
  const fromPosition = isEmptyRelease(releaseTags, fromTag) ? -1 : releaseTags.indexOf(fromTag)
  const laterReleases = history.releases.filter((_, position) => position > fromPosition)

  function changeFramework(name: string) {
    const next = sources.find((candidate) => candidate.name === name)
    if (next === undefined) return
    const range = resolveComparisonRange(
      next.releases.map((release) => release.tag),
      null,
      null,
    )
    showComparison(name, range.fromTag, range.toTag)
  }

  function changeFrom(tag: string) {
    const position = isEmptyRelease(releaseTags, tag) ? -1 : releaseTags.indexOf(tag)
    const toStillLater = releaseTags.indexOf(toTag) > position
    setCompareReleases(tag, toStillLater ? toTag : history.releases[history.releases.length - 1].tag)
  }

  const tickedKinds = selectedKinds ?? CHANGE_KINDS

  function toggleKind(kind: ChangeKind) {
    setChangeKinds(toggledKindSelection(selectedKinds, kind))
  }

  const sectionOptions = [...new Set([...counts.sections.keys(), ...sections])].sort((left, right) =>
    termLabel(vocabularyIndex, 'sections', left).localeCompare(termLabel(vocabularyIndex, 'sections', right), 'en'),
  )
  const benchmarkOptions = [...new Set([...counts.benchmarks.keys(), ...benchmarks])].sort((left, right) =>
    termLabel(vocabularyIndex, 'benchmarks', left).localeCompare(termLabel(vocabularyIndex, 'benchmarks', right), 'en'),
  )

  return (
    <aside aria-label="Filters" className="flex max-h-64 w-full flex-col border-b border-border text-sm md:max-h-none md:w-64 md:shrink-0 md:border-r md:border-b-0">
      <div data-testid="comparison-sidebar-scroll-area" className="min-h-0 flex-1 overflow-y-auto p-4">
        <FacetGroup title="Releases" startsOpen>
          <LabelledSelect label="Framework" value={source.name} onChange={changeFramework}>
            {sources.map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {termLabel(vocabularyIndex, 'sources', candidate.name)}
              </option>
            ))}
          </LabelledSelect>
          <LabelledSelect label="From" value={fromTag} onChange={changeFrom}>
            <option value={EMPTY_RELEASE_TAG}>{EMPTY_RELEASE_LABEL}</option>
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
        </FacetGroup>

        <FacetGroup title="Kind of change" startsOpen>
          {CHANGE_KINDS.map((kind) => (
            <Option key={kind} label={KIND_LABELS[kind]} count={counts.kinds[kind]} checked={tickedKinds.includes(kind)} onChange={() => toggleKind(kind)} />
          ))}
          <KindsNote selectedCount={tickedKinds.length} onShowAll={() => setChangeKinds(null)} />
        </FacetGroup>

        <FacetGroup title="Only rules that…" startsOpen>
          <Option label="have my custom changes" checked={only.includes('custom')} disabled={customisedUnavailable} onChange={() => toggleOnly('custom')} />
          {customisedUnavailable && <p className="text-xs text-muted-foreground">Your custom changes could not be loaded.</p>}
          <Option label="are in my selection" checked={only.includes('selected')} onChange={() => toggleOnly('selected')} />
        </FacetGroup>

        <FacetGroup title="Section" selectedCount={sections.length}>
          {sectionOptions.map((section) => (
            <Option key={section} label={termLabel(vocabularyIndex, 'sections', section)} count={counts.sections.get(section) ?? 0} checked={sections.includes(section)} onChange={() => toggleSection(section)} />
          ))}
        </FacetGroup>

        <FacetGroup title="Benchmark" selectedCount={benchmarks.length}>
          {benchmarkOptions.map((benchmark) => (
            <Option key={benchmark} label={termLabel(vocabularyIndex, 'benchmarks', benchmark)} count={counts.benchmarks.get(benchmark) ?? 0} checked={benchmarks.includes(benchmark)} onChange={() => toggleBenchmark(benchmark)} />
          ))}
        </FacetGroup>
      </div>
    </aside>
  )
}
