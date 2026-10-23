import { Settings2 } from 'lucide-react'
import { Fragment, useId, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useRule, useUsableOdvValue } from '@/hooks/useRule'
import { NO_VERSION_KEY } from '../../logic/applicability'
import { displayWithOdv } from '../../logic/odv'
import { assessmentLabel, benchmarkSummary, upstreamRuleId } from '../../logic/ruleDisplay'
import { sectionGroupKey, versionsUnder } from '../../logic/ruleFilters'
import { isEnabled, refKey } from '../../logic/selectionEntry'
import { compareGroupKeys, groupLabel, type VocabularyIndex } from '../../logic/vocabulary'
import { useFilterStore } from '../../state/filterStore'
import { useSelectionStore } from '../../state/selectionStore'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { RuleRow } from '../../types/rule-row'
import { RuleDetailPanel } from './RuleDetailPanel'

interface SectionGroup {
  // A vocabulary group key: grouped section codes share one table.
  section: string
  rows: RuleRow[]
}

function groupRows(rows: RuleRow[], index: VocabularyIndex): SectionGroup[] {
  const rowsBySection = new Map<string, RuleRow[]>()
  for (const row of rows) {
    const section = sectionGroupKey(row, index)
    const sectionRows = rowsBySection.get(section)
    if (sectionRows) sectionRows.push(row)
    else rowsBySection.set(section, [row])
  }
  const compareSections = compareGroupKeys(index, 'sections')
  return Array.from(rowsBySection)
    .sort(([left], [right]) => compareSections(left, right))
    .map(([section, sectionRows]) => ({
      section,
      rows: [...sectionRows].sort((left, right) => left.title.localeCompare(right.title)),
    }))
}

export function RuleTable({ rows }: { rows: RuleRow[] }) {
  const index = useVocabularyIndex()
  if (rows.length === 0) {
    return <p className="p-6 text-sm text-slate-500">No rules match the current filters.</p>
  }

  return (
    <div className="divide-y divide-slate-100">
      {groupRows(rows, index).map((sectionGroup) => (
        <SectionTable key={sectionGroup.section} sectionGroup={sectionGroup} />
      ))}
    </div>
  )
}

function SectionTable({ sectionGroup }: { sectionGroup: SectionGroup }) {
  const index = useVocabularyIndex()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const selections = useSelectionStore((store) => store.selections)
  const setEnabled = useSelectionStore((store) => store.setEnabled)

  function toggleExpanded(key: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div>
      <h2 className="sticky top-0 z-10 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
        {groupLabel(index, 'sections', sectionGroup.section)}{' '}
        <span className="font-normal text-slate-400">({sectionGroup.rows.length})</span>
      </h2>
      {/* table-fixed is load-bearing, not cosmetic: each section renders its
          own <table>, so under the default auto layout every section (and
          every expand/collapse, since a colSpan detail row also perturbs the
          calculation) would compute its own column widths from its own
          content, making the title column's start drift between sections.
          Fixed columns: checkbox 48 + chevron 32 + assessment 176 +
          benchmarks 224 = 480px, and min-w leaves the flexible title column
          room instead of squeezing it. Below md the assessment and benchmark
          columns fold under the title so phones never scroll sideways. */}
      <table className="w-full table-fixed text-sm md:min-w-[780px]">
        {/* Explicit column widths: a fixed layout otherwise takes them from
            the first row, where the two md-only cells are hidden on phones,
            so an expanded row's colSpan detail cell would add two auto-width
            columns that squeeze the title. */}
        <colgroup>
          <col className="w-12" />
          <col className="w-8" />
          <col />
          <col className="w-0 md:w-44" />
          <col className="w-0 md:w-56" />
        </colgroup>
        <tbody>
          {sectionGroup.rows.map((row) => {
            const key = refKey(row.ref)
            const isExpanded = expanded.has(key)
            const detailId = `rule-detail-${key}`
            // Always-reserved, normally-transparent left border (rather
            // than one that appears/disappears) so toggling expand never
            // shifts the row's contents.
            const expandedAccent = isExpanded ? 'border-indigo-500 bg-indigo-50' : 'border-transparent'
            return (
              <Fragment key={key}>
                <tr
                  className={`cursor-pointer border-l-4 align-top ${expandedAccent} ${isExpanded ? 'hover:bg-indigo-100' : 'hover:bg-slate-50'}`}
                  onClick={(event) => {
                    // Let the checkbox (or any other control in the row)
                    // handle its own click instead of also toggling expand.
                    // Base UI's Checkbox renders role="checkbox", not a real
                    // <input>, so it needs its own selector here.
                    if ((event.target as HTMLElement).closest('input, a, button, [data-slot="checkbox"]')) return
                    toggleExpanded(key)
                  }}
                >
                  <td className="w-12 py-2 pl-4 md:pl-6">
                    <RowCheckbox
                      ruleId={upstreamRuleId(row.ref.id)}
                      checked={isEnabled(selections, row.ref)}
                      onCheckedChange={(checked) => setEnabled(row.ref, checked)}
                    />
                  </td>
                  <td className="w-8 py-1.5 text-center text-slate-400">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-expanded={isExpanded}
                      aria-controls={detailId}
                      aria-label={isExpanded ? `Collapse ${upstreamRuleId(row.ref.id)}` : `Expand ${upstreamRuleId(row.ref.id)}`}
                      onClick={() => toggleExpanded(key)}
                    >
                      {isExpanded ? '▾' : '▸'}
                    </Button>
                  </td>
                  <td className="px-2 py-1.5">
                    <RuleTitle row={row} />
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 md:hidden">
                      <AssessmentBadge row={row} />
                      <BenchmarkText row={row} />
                    </div>
                  </td>
                  <td className="hidden w-44 px-2 py-1.5 md:table-cell">
                    <AssessmentBadge row={row} />
                  </td>
                  <td className="hidden w-56 px-2 py-1.5 md:table-cell">
                    <BenchmarkText row={row} />
                  </td>
                </tr>
                {isExpanded && (
                  <tr id={detailId} className={`border-l-4 ${expandedAccent}`}>
                    <td colSpan={5} className="p-0">
                      <RuleDetailPanel ruleRef={row.ref} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

interface RowCheckboxProps {
  ruleId: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

// An explicit aria-labelledby makes Base UI skip its per-render lookup of the
// checkbox's associated <label> (an O(DOM size) read of the hidden input's
// .labels). Across 1,493 rows that lookup dominated every table repaint.
function RowCheckbox({ ruleId, checked, onCheckedChange }: RowCheckboxProps) {
  const labelId = useId()
  return (
    <>
      <span id={labelId} className="sr-only">
        {`Select ${ruleId}`}
      </span>
      <Checkbox
        aria-labelledby={labelId}
        checked={checked}
        onCheckedChange={(nextChecked) => onCheckedChange(nextChecked === true)}
      />
    </>
  )
}

const ODV_PLACEHOLDER = '$ODV'

function RuleTitle({ row }: { row: RuleRow }) {
  // Only titles that mention $ODV need the rule's recommended value, so only
  // those fetch the full rule (cached by fetchRule).
  const needsValue = row.hasOdv && row.title.includes(ODV_PLACEHOLDER)
  const ruleState = useRule(needsValue ? row.ref : null)
  const value = useUsableOdvValue(ruleState.status === 'ready' ? ruleState.rule : null, row.ref)

  return (
    <div className="min-w-0">
      <span className="break-words">
        {displayWithOdv(row.title, value)}
        {row.hasOdv && (
          <span role="img" title="Has an organization-defined value" aria-label="Has an organization-defined value">
            <Settings2 className="ml-1.5 inline size-4 align-text-bottom text-indigo-500" />
          </span>
        )}
      </span>
      <div className="font-mono text-xs break-all text-slate-400">{upstreamRuleId(row.ref.id)}</div>
    </div>
  )
}

function AssessmentBadge({ row }: { row: RuleRow }) {
  const index = useVocabularyIndex()
  const { label, description } = assessmentLabel(row.assessment, index)
  const isAutomated = row.assessment.status === 'automated'
  // Semantic green/amber isn't one of the preset's badge variants, so it's
  // applied as a className override on top of the base Badge.
  const badgeClass = isAutomated ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'

  return (
    <Badge className={badgeClass} title={description ?? undefined}>
      {label}
    </Badge>
  )
}

function BenchmarkText({ row }: { row: RuleRow }) {
  const index = useVocabularyIndex()
  const selectedVersions = useFilterStore((store) => store.versions)
  const hasVersionedEntry = row.scopeKeys.some((key) => key !== NO_VERSION_KEY)
  if (!hasVersionedEntry && row.benchmarks.length === 0) return <span className="text-xs text-slate-400 italic">No version listed</span>
  const summary = benchmarkSummary(row.applicability, versionsUnder(row, selectedVersions, index), index)
  if (!summary) return <span className="text-xs text-slate-400 italic">Not in a benchmark</span>
  return <span className="text-xs break-words text-slate-500">{summary}</span>
}
