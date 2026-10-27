import type { CatalogPlan, ProductLicenceEntry } from '../types/catalog'

export interface PlanFeatureList {
  plan: CatalogPlan
  // Set when the plan is the previous plan plus extras; featureIds then holds only the extras.
  basedOnPlanTitle: string | null
  featureIds: string[]
}

export function planFeatureLists(plans: CatalogPlan[]): PlanFeatureList[] {
  return plans.map((plan, position) => {
    const previous = position === 0 ? undefined : plans[position - 1]
    const isBuiltOnPrevious = previous !== undefined && previous.features.length > 0 && previous.features.every((featureId) => plan.features.includes(featureId))
    if (!isBuiltOnPrevious) return { plan, basedOnPlanTitle: null, featureIds: plan.features }
    const inherited = new Set(previous.features)
    return { plan, basedOnPlanTitle: previous.title, featureIds: plan.features.filter((featureId) => !inherited.has(featureId)) }
  })
}

export interface LicenceRow {
  licence: string
  planIds: string[]
  customPlanTitles: string[]
  viaPlanIds: string[]
  packageIds: string[]
  notes: string[]
}

function appendOnce(values: string[], value: string | null) {
  if (value !== null && !values.includes(value)) values.push(value)
}

// One row per licence, however many plans it lists the product under. Entries
// arrive sorted by licence, so the rows keep that order.
export function groupLicenceEntries(entries: ProductLicenceEntry[]): LicenceRow[] {
  const rowsByLicence = new Map<string, LicenceRow>()
  for (const entry of [...entries].sort((left, right) => (left.licence < right.licence ? -1 : left.licence > right.licence ? 1 : 0))) {
    let row = rowsByLicence.get(entry.licence)
    if (row === undefined) {
      row = { licence: entry.licence, planIds: [], customPlanTitles: [], viaPlanIds: [], packageIds: [], notes: [] }
      rowsByLicence.set(entry.licence, row)
    }
    appendOnce(row.planIds, entry.planId)
    appendOnce(row.customPlanTitles, entry.customPlanTitle)
    appendOnce(row.viaPlanIds, entry.viaPlanId)
    appendOnce(row.packageIds, entry.package)
    appendOnce(row.notes, entry.note)
  }
  return [...rowsByLicence.values()]
}
