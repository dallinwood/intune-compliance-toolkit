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
  CatalogProduct,
  CatalogRequirement,
  CatalogVendor,
  ProductLicenceEntry,
} from '../types/catalog'
import { effectiveInclusions } from './catalogResolver'

export const CATALOG_INDEX_SCHEMA_VERSION = 3

type JsonObject = Record<string, unknown>

export interface CatalogSourceFile {
  kind: 'vendors' | 'product' | 'licence'
  fileName: string
  value: unknown
}

export const AVAILABILITIES: readonly Availability[] = ['included', 'add_on']
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

const REQUIREMENT_OPERATORS = ['all_of', 'any_of'] as const

// Same shape as the catalog schemas: an id, or a one-key group of two or more members.
export function isRequirement(value: unknown): value is CatalogRequirement {
  if (isText(value)) return true
  if (!isObject(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== 1 || !REQUIREMENT_OPERATORS.includes(keys[0] as (typeof REQUIREMENT_OPERATORS)[number])) return false
  const members = value[keys[0]]
  return Array.isArray(members) && members.length >= 2 && members.every(isRequirement)
}

function isRequirementOrNull(value: unknown): value is CatalogRequirement | null {
  return value === null || isRequirement(value)
}

function isProductLicenceEntry(value: unknown): value is ProductLicenceEntry {
  return (
    isObject(value) &&
    isText(value.licence) &&
    AVAILABILITIES.includes(value.availability as Availability) &&
    ['direct', 'licence'].includes(value.via as string) &&
    isTextList(value.viaLicenceIds) &&
    isTextOrNull(value.note)
  )
}

// Fields from retired formats, refused so a stale file is reported rather than half-read.
const LEGACY_INCLUSION_FIELDS = ['product', 'package', 'plan', 'custom_plan']

function isInclusion(value: unknown): value is CatalogInclusion {
  if (!isObject(value) || LEGACY_INCLUSION_FIELDS.some((field) => field in value)) return false
  return (
    (value.type === 'product' || value.type === 'licence') &&
    isText(value.target) &&
    AVAILABILITIES.includes(value.availability as Availability) &&
    isTextOrNull(value.note)
  )
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
    isRequirementOrNull(value.requires) &&
    isTextOrNull(value.category) &&
    isTextOrNull(value.description) &&
    isLinkList(value.links) &&
    Array.isArray(value.targets) &&
    value.targets.every(isText)
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
    isRequirementOrNull(value.requires) &&
    isTextOrNull(value.description) &&
    isLinkList(value.links) &&
    Array.isArray(value.includes) &&
    value.includes.every(isInclusion) &&
    isTextList(value.review)
  )
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
    compareText(left.viaLicenceIds.join('/'), right.viaLicenceIds.join('/')) ||
    compareText(left.availability, right.availability)
  )
}

function buildByProduct(licences: CatalogLicence[], licencesById: Map<string, CatalogLicence>): Record<string, ProductLicenceEntry[]> {
  const byProduct: Record<string, ProductLicenceEntry[]> = {}

  function add(productId: string, entry: ProductLicenceEntry) {
    byProduct[productId] = [...(byProduct[productId] ?? []), entry]
  }

  for (const licence of licences) {
    for (const inclusion of effectiveInclusions(licence, licencesById)) {
      add(inclusion.target, {
        licence: licence.id,
        availability: inclusion.availability,
        via: inclusion.via,
        viaLicenceIds: inclusion.viaLicenceIds,
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
  const fileByKindAndId = new Map<string, string>()
  const orderedFiles = [...files].sort((left, right) => compareText(left.fileName, right.fileName))

  // Products and licences have separate id namespaces (as in tools/catalog.py).
  function claimId(kind: 'product' | 'licence', id: string, fileName: string): boolean {
    const claimKey = `${kind}:${id}`
    const earlierFile = fileByKindAndId.get(claimKey)
    if (earlierFile !== undefined) {
      warn(`${fileName}: id ${id} is already used by ${earlierFile}. It was skipped.`)
      return false
    }
    fileByKindAndId.set(claimKey, fileName)
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
      if (claimId('product', value.id, fileName)) productsById.set(value.id, value)
    } else {
      if (!isCatalogLicence(value)) {
        warn(`${fileName}: it is not a usable licence file. It was skipped.`)
        continue
      }
      if (claimId('licence', value.id, fileName)) licencesById.set(value.id, value)
    }
  }

  const licences = [...licencesById.values()].sort(compareById)
  const allLicencesById = new Map(licences.map((licence) => [licence.id, licence]))
  for (const licence of licences) {
    for (const inclusion of licence.includes) {
      if (inclusion.type === 'product') {
        if (!productsById.has(inclusion.target)) warn(`${licence.id}: inclusion references unknown product ${inclusion.target}.`)
      } else if (!allLicencesById.has(inclusion.target)) {
        warn(`${licence.id}: inclusion references unknown licence ${inclusion.target}.`)
      }
    }
  }
  return {
    schema_version: CATALOG_INDEX_SCHEMA_VERSION,
    vendors: [...vendorsById.values()].sort(compareById),
    products: [...productsById.values()].sort(compareById),
    licences,
    by_product: buildByProduct(licences, allLicencesById),
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
  if (!Object.values(value.by_product).every((entries) => Array.isArray(entries) && entries.every(isProductLicenceEntry))) {
    return 'by_product must contain lists of product licence entries'
  }
  return value as unknown as CatalogIndex
}
