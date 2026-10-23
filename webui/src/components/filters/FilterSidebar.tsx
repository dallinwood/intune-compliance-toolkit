import { ChevronDown, ChevronUp } from 'lucide-react'
import { cloneElement, isValidElement, useId, useMemo, useRef, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useScrollEdges } from '@/hooks/useScrollEdges'
import { FACET_EXIT_TRANSITION_MS, useStableFacetShown } from '@/hooks/useStableFacetShown'
import {
  allFacetValues,
  benchmarkFacetLabel,
  benchmarkGroupsWithSeverities,
  benchmarksListedUnder,
  compareBenchmarkFacetValues,
  compareTargetGroupKeys,
  facetOptions,
  sectionGroupKey,
  sourceGroupKey,
  tagGroupKeys,
  targetGroupKeys,
  versionsListingAnyOf,
} from '../../logic/ruleFilters'
import { NONE_LABEL, NO_TARGET_KEY, NO_VERSION_KEY, compareScopeKeys } from '../../logic/applicability'
import { compareGroupKeys, groupLabel, type VocabularyIndex, type VocabularyName } from '../../logic/vocabulary'
import { useFilterStore, type AutomatableFilter } from '../../state/filterStore'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { RuleRow } from '../../types/rule-row'

const AUTOMATABLE_OPTIONS = [
  { value: 'all', label: 'All rules' },
  { value: 'automatable', label: 'Automatable' },
  { value: 'manual', label: 'Manual only' },
] as const

function isAutomatableFilter(value: string): value is AutomatableFilter {
  return AUTOMATABLE_OPTIONS.some((option) => option.value === value)
}

const NO_SELECTION: ReadonlySet<string> = new Set()

// Every facet value is a vocabulary group key (a benchmark's is paired with
// a severity, see benchmarkFacetValue), so grouped codes show as one option.
// Built once per index so StableFacetGroup's memoized canonical order isn't
// recomputed on every render by fresh inline functions.
function facetAccessors(index: VocabularyIndex) {
  const labelIn = (vocabulary: VocabularyName) => (groupKey: string) => groupLabel(index, vocabulary, groupKey)
  // "None" is applied in code, never read from the vocabulary.
  const labelOrNone = (vocabulary: VocabularyName, noneKey: string) => (groupKey: string) =>
    groupKey === noneKey ? NONE_LABEL : groupLabel(index, vocabulary, groupKey)
  return {
    allVersionsOf: (row: RuleRow) => versionsListingAnyOf(row, NO_SELECTION, index),
    allBenchmarksOf: (row: RuleRow) => benchmarksListedUnder(row, NO_SELECTION, index),
    targetsOf: (row: RuleRow) => targetGroupKeys(row, index),
    sourceOf: (row: RuleRow) => sourceGroupKey(row, index),
    sectionOf: (row: RuleRow) => sectionGroupKey(row, index),
    tagsOf: (row: RuleRow) => tagGroupKeys(row, index),
    targetLabel: labelOrNone('targets', NO_TARGET_KEY),
    sourceLabel: labelIn('sources'),
    versionLabel: labelOrNone('versions', NO_VERSION_KEY),
    sectionLabel: labelIn('sections'),
    tagLabel: labelIn('tags'),
    compareBenchmarks: compareBenchmarkFacetValues(index),
    compareTargets: compareTargetGroupKeys(index),
    compareSources: compareGroupKeys(index, 'sources'),
    compareSections: compareGroupKeys(index, 'sections'),
    compareTags: compareGroupKeys(index, 'tags'),
  }
}

export function FilterSidebar({ rows }: { rows: RuleRow[] }) {
  const filters = useFilterStore()
  const index = useVocabularyIndex()
  const accessors = useMemo(() => facetAccessors(index), [index])
  // Taken from every row, not just the reachable ones, so an option's label
  // never changes as other filters narrow the list.
  const benchmarkLabel = useMemo(() => {
    const groupsWithSeverities = benchmarkGroupsWithSeverities(allFacetValues(rows, accessors.allBenchmarksOf))
    return (value: string) => benchmarkFacetLabel(index, value, groupsWithSeverities)
  }, [rows, accessors, index])

  // Facets are derived from whatever data is actually loaded - never a
  // hardcoded list - so a new benchmark or tag shows up automatically.
  // Each facet is also narrowed by every *other* currently-applied filter,
  // so a facet never offers a choice that would filter the table down to
  // zero rows. Versions and benchmarks are additionally scoped to each
  // other, because a rule's benchmarks differ per version.
  const targets = useMemo(
    () => facetOptions(rows, filters, 'targets', accessors.targetsOf, filters.targets, index),
    [rows, filters, accessors, index],
  )
  const sources = useMemo(
    () => facetOptions(rows, filters, 'sources', accessors.sourceOf, filters.sources, index),
    [rows, filters, accessors, index],
  )
  const versions = useMemo(
    () =>
      facetOptions(
        rows,
        filters,
        'versions',
        (row) => versionsListingAnyOf(row, filters.benchmarks, index),
        filters.versions,
        index,
      ),
    [rows, filters, index],
  )
  const benchmarks = useMemo(
    () =>
      facetOptions(
        rows,
        filters,
        'benchmarks',
        (row) => benchmarksListedUnder(row, filters.versions, index),
        filters.benchmarks,
        index,
      ),
    [rows, filters, index],
  )
  const sections = useMemo(
    () => facetOptions(rows, filters, 'sections', accessors.sectionOf, filters.sections, index),
    [rows, filters, accessors, index],
  )
  const tags = useMemo(
    () => facetOptions(rows, filters, 'tags', accessors.tagsOf, filters.tags, index),
    [rows, filters, accessors, index],
  )

  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const { canScrollUp, canScrollDown } = useScrollEdges(scrollAreaRef)

  return (
    <aside className="flex max-h-64 w-full flex-col border-b border-slate-200 text-sm md:max-h-none md:w-64 md:shrink-0 md:border-r md:border-b-0">
      <div className="p-4 pb-3">
        <Input
          type="search"
          aria-label="Search title or id"
          placeholder="Search title or id…"
          value={filters.search}
          onChange={(event) => filters.setSearch(event.target.value)}
          className="h-8 rounded text-sm"
        />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scrollAreaRef} data-testid="sidebar-scroll-area" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <FacetGroup title="Automation">
            <RadioGroup
              value={filters.automatable}
              onValueChange={(value) => {
                if (isAutomatableFilter(value)) filters.setAutomatable(value)
              }}
              className="gap-1.5"
            >
              {AUTOMATABLE_OPTIONS.map((option) => (
                <FacetOption key={option.value} label={option.label}>
                  <RadioGroupItem value={option.value} />
                </FacetOption>
              ))}
            </RadioGroup>
          </FacetGroup>

          <StableFacetGroup
            title="Target"
            rows={rows}
            valueOf={accessors.targetsOf}
            compareValues={accessors.compareTargets}
            labelOf={accessors.targetLabel}
            reachable={targets}
            selected={filters.targets}
            onToggle={filters.toggleTarget}
          />

          <StableFacetGroup
            title="Version"
            rows={rows}
            valueOf={accessors.allVersionsOf}
            compareValues={compareScopeKeys}
            labelOf={accessors.versionLabel}
            reachable={versions}
            selected={filters.versions}
            onToggle={filters.toggleVersion}
          />

          <StableFacetGroup
            title="Benchmark"
            rows={rows}
            valueOf={accessors.allBenchmarksOf}
            compareValues={accessors.compareBenchmarks}
            labelOf={benchmarkLabel}
            reachable={benchmarks}
            selected={filters.benchmarks}
            onToggle={filters.toggleBenchmark}
          />

          <StableFacetGroup
            title="Section"
            rows={rows}
            valueOf={accessors.sectionOf}
            compareValues={accessors.compareSections}
            labelOf={accessors.sectionLabel}
            reachable={sections}
            selected={filters.sections}
            onToggle={filters.toggleSection}
          />

          <StableFacetGroup
            title="Tags"
            rows={rows}
            valueOf={accessors.tagsOf}
            compareValues={accessors.compareTags}
            labelOf={accessors.tagLabel}
            reachable={tags}
            selected={filters.tags}
            onToggle={filters.toggleTag}
          />

          <StableFacetGroup
            title="Source"
            rows={rows}
            valueOf={accessors.sourceOf}
            compareValues={accessors.compareSources}
            labelOf={accessors.sourceLabel}
            reachable={sources}
            selected={filters.sources}
            onToggle={filters.toggleSource}
          />

          <Button type="button" variant="link" size="xs" onClick={filters.clear} className="mt-2 h-auto p-0">
            Clear filters
          </Button>
        </div>
        <ScrollIndicator direction="up" visible={canScrollUp} />
        <ScrollIndicator direction="down" visible={canScrollDown} />
      </div>
    </aside>
  )
}

function ScrollIndicator({ direction, visible }: { direction: 'up' | 'down'; visible: boolean }) {
  const Chevron = direction === 'up' ? ChevronUp : ChevronDown
  const placement = direction === 'up' ? 'top-0 bg-gradient-to-b items-start' : 'bottom-0 bg-gradient-to-t items-end'
  return (
    <div
      aria-hidden="true"
      data-testid={`sidebar-scroll-${direction}`}
      className={`pointer-events-none absolute inset-x-0 flex h-8 justify-center from-background to-transparent transition-opacity duration-200 ${placement} ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <Chevron className="size-4 text-slate-400" />
    </div>
  )
}

function FacetGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="mb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">{title}</h2>
      <div>{children}</div>
    </div>
  )
}

// Pairs a Checkbox/RadioGroupItem with its Label via htmlFor/id rather than
// nesting it inside <label> - Base UI's checkbox/radio render a
// role="checkbox"/role="radio" element, not a native <input>, so the
// implicit label-wraps-control association isn't guaranteed the way it is
// for a real <input type="checkbox">. Facet values are free text
// ("cnssi-1253_high", "27.0") so they aren't usable as DOM ids directly -
// useId() sidesteps that entirely.
function FacetOption({ label, disabled, children }: { label: string; disabled?: boolean; children: ReactNode }) {
  const id = useId()
  const control = isValidElement<{ id?: string }>(children) ? cloneElement(children, { id }) : children

  return (
    <div className="flex items-center gap-2 py-0.5">
      {control}
      <Label
        htmlFor={id}
        className={disabled ? 'truncate text-sm font-normal text-slate-400 line-through' : 'truncate text-sm font-normal'}
      >
        {label}
      </Label>
    </div>
  )
}

// A facet checkbox list, rendered in a fixed reference order (every value
// that ever occurs for this dimension, regardless of filters) rather than
// the dynamic reachable-only order `facetOptions` returns on its own - so
// checking a box collapses at most the rows that actually became
// unreachable instead of reshuffling the whole section. Values that fall
// out of `reachable` don't vanish immediately: `useStableFacetShown` keeps
// them rendered, disabled and struck-through, for a short quiet period
// (see that hook's comment) so a run of quick clicks doesn't make the panel
// keep reflowing under the user's cursor.
function StableFacetGroup({
  title,
  rows,
  valueOf,
  compareValues,
  labelOf,
  reachable,
  selected,
  onToggle,
}: {
  title: string
  rows: RuleRow[]
  valueOf: (row: RuleRow) => string | string[]
  compareValues?: (left: string, right: string) => number
  labelOf: (value: string) => string
  reachable: string[]
  selected: ReadonlySet<string>
  onToggle: (value: string) => void
}) {
  const canonicalOrder = useMemo(() => allFacetValues(rows, valueOf, compareValues), [rows, valueOf, compareValues])
  const reachableSet = useMemo(() => new Set(reachable), [reachable])
  const { shown, leaving } = useStableFacetShown(reachable)

  const hasShownValue = canonicalOrder.some((value) => shown.has(value))
  // Once every option has faded out (e.g. Tags with only ASD ISM rules left)
  // a bare heading would be noise; a selected value keeps its group so it can
  // be unchecked.
  if (!hasShownValue && selected.size === 0) return null

  return (
    <FacetGroup title={title}>
      {canonicalOrder
        .filter((value) => shown.has(value))
        .map((value) => {
          const isReachable = reachableSet.has(value)
          const isLeaving = leaving.has(value)
          return (
            // The grid-rows 1fr->0fr trick animates height even though the
            // row's content height is intrinsic ("auto"), which a plain
            // height/max-height transition can't do without measuring it in
            // JS first. `min-h-0` on the inner wrapper is load-bearing: a
            // grid item's default min-height is its content's height, which
            // would stop this from ever visually reaching zero. Rows below
            // this one naturally slide up as it shrinks - that's just normal
            // block layout responding to the shrinking box each frame, no
            // extra work needed for it.
            <div
              key={value}
              data-leaving={isLeaving}
              className={`grid overflow-hidden transition-[grid-template-rows,opacity] ease-in-out ${
                isLeaving ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
              }`}
              style={{ transitionDuration: `${FACET_EXIT_TRANSITION_MS}ms` }}
            >
              <div className="min-h-0">
                <FacetOption label={labelOf(value)} disabled={!isReachable}>
                  <Checkbox checked={selected.has(value)} disabled={!isReachable} onCheckedChange={() => onToggle(value)} />
                </FacetOption>
              </div>
            </div>
          )
        })}
    </FacetGroup>
  )
}
