import type { CatalogLicence, CatalogProduct } from '../types/catalog'
import { effectiveInclusions, effectiveInclusionTree, type EffectiveInclusion, type InclusionNode } from './catalogTree'
import { supplyingLicenceIdOf } from './inclusionDisplay'

export interface CompareRow {
  product: CatalogProduct
  depth: number
  // One per compared licence, in the order given; null when the licence lacks the product.
  cells: (EffectiveInclusion | null)[]
}

// A product reached several ways shows one cell: included beats add-on, then a
// direct entry beats a nested licence, then the first nested route in the
// licence's own include order.
function inclusionsByProduct(licence: CatalogLicence, licencesById: Map<string, CatalogLicence>): Map<string, EffectiveInclusion> {
  const byProduct = new Map<string, EffectiveInclusion>()
  for (const inclusion of effectiveInclusions(licence, licencesById)) {
    const existing = byProduct.get(inclusion.target)
    if (
      existing === undefined ||
      (inclusion.availability === 'included' && existing.availability === 'add_on') ||
      (inclusion.availability === existing.availability && inclusion.via === 'direct' && existing.via !== 'direct')
    ) byProduct.set(inclusion.target, inclusion)
  }
  return byProduct
}

// Rows follow the single-licence tree: categories alphabetically, roots and
// children by title. Ancestors the licences do not list appear as context rows.
export function compareRows(licences: CatalogLicence[], productsById: Map<string, CatalogProduct>, allLicences: CatalogLicence[] = licences): CompareRow[] {
  const licencesById = new Map(allLicences.map((licence) => [licence.id, licence]))
  const perLicence = licences.map((licence) => inclusionsByProduct(licence, licencesById))
  const unionInclusions = new Map<string, EffectiveInclusion>()
  for (const byProduct of perLicence) {
    for (const [productId, inclusion] of byProduct) {
      if (!unionInclusions.has(productId)) unionInclusions.set(productId, inclusion)
    }
  }

  const rows: CompareRow[] = []
  function visit(node: InclusionNode, depth: number) {
    rows.push({ product: node.product, depth, cells: perLicence.map((byProduct) => byProduct.get(node.product.id) ?? null) })
    for (const child of node.children) visit(child, depth + 1)
  }
  for (const { roots } of effectiveInclusionTree([...unionInclusions.values()], productsById)) {
    for (const root of roots) visit(root, 0)
  }
  return rows
}

// Drops the rows that are the same in every column, but keeps any ancestor of
// a row that stays, so an indented child never appears without its parent.
export function withoutIdenticalRows(rows: CompareRow[]): CompareRow[] {
  const keptPositions = new Set<number>()
  rows.forEach((row, position) => {
    if (isUniform(row)) return
    keptPositions.add(position)
    let ancestorDepth = row.depth
    for (let earlier = position - 1; earlier >= 0 && ancestorDepth > 0; earlier -= 1) {
      if (rows[earlier].depth < ancestorDepth) {
        keptPositions.add(earlier)
        ancestorDepth = rows[earlier].depth
      }
    }
  })
  return rows.filter((_, position) => keptPositions.has(position))
}

// Two cells match when they would read the same: the same availability from
// the same supplying licence. Tiers are nested licences, so "Included via
// Entra ID P1" and "Included via Entra ID P2" are a real difference.
export function isUniform(row: CompareRow): boolean {
  const [first, ...rest] = row.cells
  return rest.every((cell) => {
    if (first === null || cell === null) return first === cell
    return cell.availability === first.availability && supplyingLicenceIdOf(cell) === supplyingLicenceIdOf(first)
  })
}
