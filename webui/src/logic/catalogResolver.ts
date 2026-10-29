import type { Availability, CatalogInclusion, CatalogLicence, CatalogProduct, ProductInclusion } from '../types/catalog'

export interface EffectiveInclusion extends ProductInclusion {
  via: 'direct' | 'plan' | 'licence'
  viaPlanId: string | null
  viaLicenceIds: string[]
  viaProductId: string | null
}

export interface PlanDerivedFeature {
  featureId: string
  viaPlanId: string
  inclusion: ProductInclusion
}

export function fullPlanId(productId: string, planId: string): string {
  return `${productId}.${planId}`
}

export function planDerivedFeatures(licence: CatalogLicence, productsById: Map<string, CatalogProduct>): PlanDerivedFeature[] {
  const directlyIncludedProductIds = new Set(
    licence.includes.flatMap((inclusion) => (inclusion.type === 'product' ? [inclusion.target] : [])),
  )
  const derived: PlanDerivedFeature[] = []
  const claimedRoutes = new Set<string>()
  for (const inclusion of licence.includes) {
    if (inclusion.type !== 'product' || inclusion.plan === undefined) continue
    const plan = productsById.get(inclusion.target)?.plans.find((candidate) => candidate.id === inclusion.plan)
    if (plan === undefined) continue
    for (const featureId of plan.features) {
      const routeId = `${featureId}\u0000${inclusion.target}\u0000${plan.id}`
      if (directlyIncludedProductIds.has(featureId) || claimedRoutes.has(routeId)) continue
      claimedRoutes.add(routeId)
      derived.push({ featureId, viaPlanId: fullPlanId(inclusion.target, plan.id), inclusion })
    }
  }
  return derived
}

function keyOf(inclusion: EffectiveInclusion): string {
  return `${inclusion.target}\u0000${inclusion.plan ?? ''}\u0000${inclusion.custom_plan?.title ?? ''}`
}

function morePreferred(left: EffectiveInclusion, right: EffectiveInclusion): boolean {
  if (left.via === 'direct' && right.via !== 'direct') return true
  if (right.via === 'direct' && left.via !== 'direct') return false
  return left.availability === 'included' && right.availability === 'add_on'
}

// Expands nested included licences while retaining alternate provenance paths.
// Add-ons on nested licences are never inherited by their enclosing licence.
export function effectiveInclusions(
  licence: CatalogLicence,
  productsById: Map<string, CatalogProduct>,
  licencesById: Map<string, CatalogLicence> = new Map(),
): EffectiveInclusion[] {
  const resolved: EffectiveInclusion[] = []

  function visit(current: CatalogLicence, path: string[], inheritedAddOn: boolean, stack: Set<string>, pathNotes: string[]) {
    if (stack.has(current.id)) return
    const nextStack = new Set(stack).add(current.id)
    const pathIsNested = path.length > 0
    const direct: EffectiveInclusion[] = current.includes.flatMap((entry): EffectiveInclusion[] => {
      if (entry.type !== 'product' || (pathIsNested && entry.availability === 'add_on')) return []
      const availability = inheritedAddOn || entry.availability === 'add_on' ? 'add_on' : 'included'
      return [{
        ...entry,
        availability,
        note: [...pathNotes, entry.note].filter((note): note is string => note !== null).join(' · ') || null,
        via: pathIsNested ? 'licence' : 'direct',
        viaPlanId: null,
        viaLicenceIds: path,
        viaProductId: null,
      }]
    })
    const planEntries: EffectiveInclusion[] = planDerivedFeatures(current, productsById)
      .filter(({ inclusion }) => !pathIsNested || inclusion.availability === 'included')
      .map(({ featureId, viaPlanId, inclusion }) => ({
      type: 'product',
      target: featureId,
      availability: inheritedAddOn || inclusion.availability === 'add_on' ? 'add_on' : 'included',
      note: [...pathNotes, inclusion.note].filter((note): note is string => note !== null).join(' · ') || null,
      via: pathIsNested ? 'licence' : 'plan',
      viaPlanId,
      viaLicenceIds: path,
      viaProductId: viaPlanId.slice(0, viaPlanId.lastIndexOf('.')),
      }))
    const directKeys = new Set(direct.map(keyOf))
    const entries = [...direct, ...planEntries.filter((entry) => !directKeys.has(keyOf(entry)))]
    const bestByRoute = new Map<string, EffectiveInclusion>()
    for (const entry of entries) {
      const routeKey = `${keyOf(entry)}\u0000${entry.via}\u0000${entry.viaPlanId ?? ''}\u0000${entry.viaLicenceIds.join('\u0000')}`
      const existing = bestByRoute.get(routeKey)
      if (existing === undefined || morePreferred(entry, existing)) bestByRoute.set(routeKey, entry)
    }
    resolved.push(...bestByRoute.values())

    for (const edge of current.includes) {
      if (edge.type !== 'licence' || (pathIsNested && edge.availability !== 'included')) continue
      const nested = licencesById.get(edge.target)
      if (nested !== undefined) {
        visit(
          nested,
          [...path, nested.id],
          inheritedAddOn || edge.availability === 'add_on',
          nextStack,
          [...pathNotes, ...(edge.note === null ? [] : [edge.note])],
        )
      }
    }
  }

  visit(licence, [], false, new Set(), [])
  return resolved
}

export function combineAvailability(left: Availability, right: Availability): Availability {
  return left === 'add_on' || right === 'add_on' ? 'add_on' : 'included'
}

export type LicenceInclusion = Extract<CatalogInclusion, { type: 'licence' }>
