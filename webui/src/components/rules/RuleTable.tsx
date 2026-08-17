import { naturalIdCompare, topLevelSection } from '../../logic/naturalId'
import type { RuleRow } from '../../types/rule-row'

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
  return (
    <div>
      <h4 className="px-6 py-1 text-xs font-semibold text-slate-500">Section {sectionGroup.section}</h4>
      <table className="w-full text-sm">
        <tbody>
          {sectionGroup.rows.map((row) => (
            <tr key={`${row.ref.product}-${row.ref.version}-${row.ref.file}`} className="hover:bg-slate-50">
              <td className="w-20 px-6 py-1 font-mono text-xs text-slate-500">{row.ref.id}</td>
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
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AssessmentBadge({ row }: { row: RuleRow }) {
  const isAutomated = row.assessmentStatus === 'Automated'
  const badgeClass = isAutomated ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'

  return (
    <span className="inline-flex items-center gap-1">
      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badgeClass}`}>{row.assessmentStatus}</span>
      {row.sourceAssessmentStatus !== row.assessmentStatus && (
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500" title="CIS's own label for this rule">
          CIS: {row.sourceAssessmentStatus}
        </span>
      )}
    </span>
  )
}
