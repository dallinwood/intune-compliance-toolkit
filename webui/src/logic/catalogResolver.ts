import type { CatalogLicence, ProductInclusion } from '../types/catalog'

export interface EffectiveInclusion extends ProductInclusion {
  via: 'direct' | 'licence'
  // Nested licence path from the outer licence to the licence listing the product.
  viaLicenceIds: string[]
}

function routeKeyOf(inclusion: EffectiveInclusion): string {
  return [inclusion.target, inclusion.via, ...inclusion.viaLicenceIds].join('\u0000')
}

function isIncludedOverAddOn(candidate: EffectiveInclusion, existing: EffectiveInclusion): boolean {
  return candidate.availability === 'included' && existing.availability === 'add_on'
}

function joinNotes(notes: (string | null)[]): string | null {
  return notes.filter((note): note is string => note !== null).join(' · ') || null
}

// Expands nested included licences while retaining alternate provenance paths.
// Add-ons on nested licences are never inherited by their enclosing licence.
export function effectiveInclusions(licence: CatalogLicence, licencesById: Map<string, CatalogLicence> = new Map()): EffectiveInclusion[] {
  const resolved: EffectiveInclusion[] = []

  function visit(current: CatalogLicence, path: string[], inheritedAddOn: boolean, stack: Set<string>, pathNotes: string[]) {
    if (stack.has(current.id)) return
    const nextStack = new Set(stack).add(current.id)
    const pathIsNested = path.length > 0
    const bestByRoute = new Map<string, EffectiveInclusion>()
    for (const entry of current.includes) {
      if (entry.type !== 'product' || (pathIsNested && entry.availability === 'add_on')) continue
      const inclusion: EffectiveInclusion = {
        ...entry,
        availability: inheritedAddOn || entry.availability === 'add_on' ? 'add_on' : 'included',
        note: joinNotes([...pathNotes, entry.note]),
        via: pathIsNested ? 'licence' : 'direct',
        viaLicenceIds: path,
      }
      const routeKey = routeKeyOf(inclusion)
      const existing = bestByRoute.get(routeKey)
      if (existing === undefined || isIncludedOverAddOn(inclusion, existing)) bestByRoute.set(routeKey, inclusion)
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
