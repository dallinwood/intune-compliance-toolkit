// The product and licence catalog (docs/plans/2026-10-27-product-licence-catalog-design.md)
// is hand-written files under catalog/. The publish step
// (scripts/copy-baselines.mjs) turns them into one index, catalog/_index.json,
// so the app needs a single startup fetch. tools/catalog.py is the CI gate;
// this side only checks structure, skipping what it cannot use.

import type {
  Availability,
  CatalogIndex,
  CatalogInclusion,
  CatalogLicence,
  CatalogLink,
  CatalogPlan,
  CatalogProduct,
  CatalogVendor,
  ProductLicenceEntry,
} from '../types/catalog'

export const CATALOG_INDEX_SCHEMA_VERSION = 1

type JsonObject = Record<string, unknown>

export interface CatalogSourceFile {
  kind: 'vendors' | 'product' | 'licence'
  fileName: string
  value: unknown
}

const AVAILABILITIES: readonly Availability[] = ['included', 'add_on', 'package_feature']
const LICENCE_KINDS: readonly CatalogLicence['kind'][] = ['subscription', 'add_on']

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function isTextOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isText)
}

function isLinkList(value: unknown): value is CatalogLink[] {
  return Array.isArray(value) && value.every((link) => isObject(link) && isText(link.title) && isText(link.url))
}

function isPlan(value: unknown): value is CatalogPlan {
  return isObject(value) && isText(value.id) && isText(value.title) && isTextOrNull(value.description) && isTextList(value.features)
}

function isInclusion(value: unknown): value is CatalogInclusion {
  if (!isObject(value) || !isText(value.product) || !isTextOrNull(value.note)) return false
  if (!AVAILABILITIES.includes(value.availability as Availability)) return false
  if (value.plan !== undefined && !isText(value.plan)) return false
  const customPlan = value.custom_plan
  return customPlan === undefined || (isObject(customPlan) && isText(customPlan.title) && isTextOrNull(customPlan.description))
}

export function isCatalogVendor(value: unknown): value is CatalogVendor {
  return isObject(value) && isText(value.id) && isText(value.title) && isTextOrNull(value.url)
}

export function isCatalogProduct(value: unknown): value is CatalogProduct {
  return (
    isObject(value) &&
    isText(value.id) &&
    isText(value.title) &&
    isText(value.vendor) &&
    isTextOrNull(value.parent) &&
    isTextOrNull(value.category) &&
    isTextOrNull(value.description) &&
    isLinkList(value.links) &&
    Array.isArray(value.targets) &&
    value.targets.every(isText) &&
    Array.isArray(value.plans) &&
    value.plans.every(isPlan)
  )
}

export function isCatalogLicence(value: unknown): value is CatalogLicence {
  return (
    isObject(value) &&
    isText(value.id) &&
    isText(value.title) &&
    isText(value.vendor) &&
    isText(value.family) &&
    LICENCE_KINDS.includes(value.kind as CatalogLicence['kind']) &&
    isTextList(value.requires) &&
    isTextOrNull(value.description) &&
    isLinkList(value.links) &&
    Array.isArray(value.includes) &&
    value.includes.every(isInclusion) &&
    isTextList(value.review)
  )
}

export function fullPlanId(productId: string, planId: string): string {
  return `${productId}.${planId}`
}

// Plain code-unit order, never localeCompare, so the output is byte-stable
// on every machine.
export function compareText(left: string, right: string): number {
  if (left < right) return -1
  return left > right ? 1 : 0
}

function compareById(left: { id: string }, right: { id: string }): number {
  return compareText(left.id, right.id)
}

function compareEntries(left: ProductLicenceEntry, right: ProductLicenceEntry): number {
  return (
    compareText(left.licence, right.licence) ||
    compareText(left.via, right.via) ||
    compareText(left.planId ?? '', right.planId ?? '') ||
    compareText(left.viaPlanId ?? '', right.viaPlanId ?? '')
  )
}

function directEntry(licence: CatalogLicence, inclusion: CatalogInclusion): ProductLicenceEntry {
  return {
    licence: licence.id,
    availability: inclusion.availability,
    planId: inclusion.plan === undefined ? null : fullPlanId(inclusion.product, inclusion.plan),
    customPlanTitle: inclusion.custom_plan?.title ?? null,
    via: 'direct',
    viaPlanId: null,
    note: inclusion.note,
  }
}

export interface PlanDerivedFeature {
  featureId: string
  viaPlanId: string
  inclusion: CatalogInclusion
}

// The features a licence gets through the plans it lists. A feature the
// licence lists directly is left out (direct wins), and one reached through
// two plans appears once, under the first plan in the licence's includes order.
export function planDerivedFeatures(licence: CatalogLicence, productsById: Map<string, CatalogProduct>): PlanDerivedFeature[] {
  const claimedProductIds = new Set(licence.includes.map((inclusion) => inclusion.product))
  const derived: PlanDerivedFeature[] = []
  for (const inclusion of licence.includes) {
    if (inclusion.plan === undefined) continue
    const plan = productsById.get(inclusion.product)?.plans.find((candidate) => candidate.id === inclusion.plan)
    if (plan === undefined) continue
    for (const featureId of plan.features) {
      if (claimedProductIds.has(featureId)) continue
      claimedProductIds.add(featureId)
      derived.push({ featureId, viaPlanId: fullPlanId(inclusion.product, plan.id), inclusion })
    }
  }
  return derived
}

function buildByProduct(licences: CatalogLicence[], productsById: Map<string, CatalogProduct>): Record<string, ProductLicenceEntry[]> {
  const byProduct: Record<string, ProductLicenceEntry[]> = {}

  function add(productId: string, entry: ProductLicenceEntry) {
    byProduct[productId] = [...(byProduct[productId] ?? []), entry]
  }

  for (const licence of licences) {
    for (const inclusion of licence.includes) {
      add(inclusion.product, directEntry(licence, inclusion))
    }
    for (const { featureId, viaPlanId, inclusion } of planDerivedFeatures(licence, productsById)) {
      add(featureId, {
        licence: licence.id,
        availability: inclusion.availability,
        planId: null,
        customPlanTitle: null,
        via: 'plan',
        viaPlanId,
        note: inclusion.note,
      })
    }
  }

  const sortedByProduct: Record<string, ProductLicenceEntry[]> = {}
  for (const productId of Object.keys(byProduct).sort(compareText)) {
    sortedByProduct[productId] = [...byProduct[productId]].sort(compareEntries)
  }
  return sortedByProduct
}

// A structurally unusable file, or one that reuses an earlier file's id, is
// skipped and reported through `warn`. Input order does not matter: the
// output is sorted by id.
export function buildCatalogIndex(files: CatalogSourceFile[], warn: (message: string) => void): CatalogIndex {
  const vendorsById = new Map<string, CatalogVendor>()
  const productsById = new Map<string, CatalogProduct>()
  const licencesById = new Map<string, CatalogLicence>()
  const fileById = new Map<string, string>()
  const orderedFiles = [...files].sort((left, right) => compareText(left.fileName, right.fileName))

  function claimId(id: string, fileName: string): boolean {
    const earlierFile = fileById.get(id)
    if (earlierFile !== undefined) {
      warn(`${fileName}: id ${id} is already used by ${earlierFile}. It was skipped.`)
      return false
    }
    fileById.set(id, fileName)
    return true
  }

  for (const { kind, fileName, value } of orderedFiles) {
    if (kind === 'vendors') {
      if (!isObject(value) || !Array.isArray(value.vendors) || !value.vendors.every(isCatalogVendor)) {
        warn(`${fileName}: it needs a vendors list of objects with an id, title and url. It was skipped.`)
        continue
      }
      for (const vendor of value.vendors) vendorsById.set(vendor.id, vendor)
    } else if (kind === 'product') {
      if (!isCatalogProduct(value)) {
        warn(`${fileName}: it is not a usable product file. It was skipped.`)
        continue
      }
      if (claimId(value.id, fileName)) productsById.set(value.id, value)
    } else {
      if (!isCatalogLicence(value)) {
        warn(`${fileName}: it is not a usable licence file. It was skipped.`)
        continue
      }
      if (claimId(value.id, fileName)) licencesById.set(value.id, value)
    }
  }

  const licences = [...licencesById.values()].sort(compareById)
  return {
    schema_version: CATALOG_INDEX_SCHEMA_VERSION,
    vendors: [...vendorsById.values()].sort(compareById),
    products: [...productsById.values()].sort(compareById),
    licences,
    by_product: buildByProduct(licences, productsById),
  }
}

// The shape check for a published index; the arrays are checked entry by
// entry so a half-valid file is refused rather than half-shown.
export function parseCatalogIndex(value: unknown): CatalogIndex | string {
  if (!isObject(value) || value.schema_version !== CATALOG_INDEX_SCHEMA_VERSION) return `schema_version must be ${CATALOG_INDEX_SCHEMA_VERSION}`
  if (!Array.isArray(value.vendors) || !value.vendors.every(isCatalogVendor)) return 'vendors must be a list of vendors'
  if (!Array.isArray(value.products) || !value.products.every(isCatalogProduct)) return 'products must be a list of products'
  if (!Array.isArray(value.licences) || !value.licences.every(isCatalogLicence)) return 'licences must be a list of licences'
  if (!isObject(value.by_product)) return 'it needs a by_product object'
  return value as unknown as CatalogIndex
}
