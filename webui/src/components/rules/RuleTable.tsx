import { Fragment, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { naturalIdCompare, topLevelSection } from '../../logic/naturalId'
import { isEnabled, refKey } from '../../logic/selectionEntry'
import { useSelectionStore } from '../../state/selectionStore'
import type { RuleRow } from '../../types/rule-row'
import { RuleDetailPanel } from './RuleDetailPanel'

interface SectionGroup {
  section: string
  rows: RuleRow[]
}

interface VersionGroup {
  version: string
  sections: SectionGroup[]
}

interface ProductGroup {
  product: string
  versions: VersionGroup[]
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const list = grouped.get(key)
    if (list) list.push(item)
    else grouped.set(key, [item])
  }
  return grouped
}

// Groups product -> version -> top-level CIS section (first dot-segment of
// id), using the natural-id comparator rather than _index.json's plain
// string sort, which misorders ids like "2.12.2" vs "2.1.1.1".
function groupRows(rows: RuleRow[]): ProductGroup[] {
  return Array.from(groupBy(rows, (row) => row.ref.product))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([product, productRows]) => ({
      product,
      versions: Array.from(groupBy(productRows, (row) => row.ref.version))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([version, versionRows]) => ({
          version,
          sections: Array.from(groupBy(versionRows, (row) => topLevelSection(row.ref.id)))
            .sort(([a], [b]) => naturalIdCompare(a, b))
            .map(([section, sectionRows]) => ({
              section,
              rows: [...sectionRows].sort((a, b) => naturalIdCompare(a.ref.id, b.ref.id)),
            })),
        })),
    }))
}

export function RuleTable({ rows }: { rows: RuleRow[] }) {
  if (rows.length === 0) {
    return <p className="p-6 text-sm text-slate-500">No rules match the current filters.</p>
  }

  const groups = groupRows(rows)

  return (
    <div className="divide-y divide-slate-100">
      {groups.map((productGroup) => (
        <div key={productGroup.product}>
          <h2 className="sticky top-0 z-10 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
            {productGroup.product}
          </h2>
          {productGroup.versions.map((versionGroup) => (
            <div key={versionGroup.version}>
              <h3 className="px-4 py-1 text-xs font-medium tracking-wide text-slate-400 uppercase">
                {versionGroup.version}
              </h3>
              {versionGroup.sections.map((sectionGroup) => (
                <SectionTable key={sectionGroup.section} sectionGroup={sectionGroup} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function SectionTable({ sectionGroup }: { sectionGroup: SectionGroup }) {
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
      <h4 className="px-6 py-1 text-xs font-semibold text-slate-500">Section {sectionGroup.section}</h4>
      <div className="overflow-x-auto">
        {/* Fixed columns alone total ~552px (checkbox 32 + chevron 24 + id 80
            + badge 224 + profile 160 + org-value 32); min-w must clear that
            plus room for the flexible title column, or title gets squeezed
            to a sliver instead of the table actually scrolling. */}
        <table className="w-full min-w-[860px] text-sm">
          <tbody>
            {sectionGroup.rows.map((row) => {
              const key = refKey(row.ref)
              const isExpanded = expanded.has(key)
              const detailId = `rule-detail-${key}`
              return (
                <Fragment key={key}>
                  <tr
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={(event) => {
                      // Let the checkbox (or any future button/link in the row)
                      // handle its own click instead of also toggling expand.
                      if ((event.target as HTMLElement).closest('input, a, button')) return
                      toggleExpanded(key)
                    }}
                  >
                    <td className="w-8 py-1 pl-6">
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.ref.id} ${row.title}`}
                        checked={isEnabled(selections, row.ref)}
                        onChange={(event) => setEnabled(row.ref, event.target.checked)}
                      />
                    </td>
                    <td className="w-6 py-1 text-center text-slate-400">
                      <button
                        type="button"
                        className="w-full cursor-pointer"
                        aria-expanded={isExpanded}
                        aria-controls={detailId}
                        aria-label={isExpanded ? `Collapse ${row.ref.id}` : `Expand ${row.ref.id}`}
                        onClick={() => toggleExpanded(key)}
                      >
                        {isExpanded ? '▾' : '▸'}
                      </button>
                    </td>
                    <td className="w-20 px-2 py-1 font-mono text-xs text-slate-500">{row.ref.id}</td>
                    <td className="px-2 py-1">{row.title}</td>
                    <td className="w-56 px-2 py-1">
                      <AssessmentBadge row={row} />
                    </td>
                    <td className="w-40 px-2 py-1 text-xs text-slate-500">{row.profileApplicability.join(', ')}</td>
                    <td
                      className="w-8 px-2 py-1 text-center text-xs"
                      title={row.requiresOrganizationDefinedValue ? 'Requires an organization-defined value' : ''}
                    >
                      {row.requiresOrganizationDefinedValue ? '⚙' : ''}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr id={detailId}>
                      <td colSpan={7} className="p-0">
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
    </div>
  )
}

function AssessmentBadge({ row }: { row: RuleRow }) {
  const isAutomated = row.assessmentStatus === 'Automated'
  // Semantic green/amber isn't one of the preset's badge variants, so it's
  // applied as a className override on top of the base Badge rather than
  // inventing a new cva variant as part of this primitives-only pass.
  const badgeClass = isAutomated ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'

  return (
    <span className="inline-flex items-center gap-1">
      <Badge className={badgeClass}>{row.assessmentStatus}</Badge>
      {row.sourceAssessmentStatus !== row.assessmentStatus && (
        <Badge variant="secondary" title="CIS's own label for this rule">
          CIS: {row.sourceAssessmentStatus}
        </Badge>
      )}
    </span>
  )
}
