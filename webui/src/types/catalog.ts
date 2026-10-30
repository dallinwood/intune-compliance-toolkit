export type Availability = 'included' | 'add_on'

export interface CatalogVendor {
  id: string
  title: string
  url: string | null
}

export interface CatalogLink {
  title: string
  url: string
}

// An id (a product id for a product, a licence id for a licence), or a group
// whose members must all hold (all_of) or at least one hold (any_of).
export type CatalogRequirement = string | { all_of: CatalogRequirement[] } | { any_of: CatalogRequirement[] }

export interface CatalogProduct {
  id: string
  title: string
  vendor: string
  parent: string | null
  // What the product needs to work; licence prerequisites live on licences.
  requires: CatalogRequirement | null
  category: string | null
  description: string | null
  links: CatalogLink[]
  targets: string[]
}

export interface ProductInclusion {
  type: 'product'
  target: string
  availability: Availability
  note: string | null
}

export interface LicenceInclusion {
  type: 'licence'
  target: string
  availability: Availability
  note: string | null
}

export type CatalogInclusion = ProductInclusion | LicenceInclusion

export interface CatalogLicence {
  id: string
  title: string
  vendor: string
  family: string
  kind: 'subscription' | 'add_on'
  // Licences that must be bought first.
  requires: CatalogRequirement | null
  description: string | null
  links: CatalogLink[]
  includes: CatalogInclusion[]
  review: string[]
}

export interface ProductLicenceEntry {
  licence: string
  availability: Availability
  via: 'direct' | 'licence'
  // Nested licence path from the outer licence to the licence listing the product.
  viaLicenceIds: string[]
  note: string | null
}

export interface CatalogIndex {
  schema_version: 3
  vendors: CatalogVendor[]
  products: CatalogProduct[]
  licences: CatalogLicence[]
  by_product: Record<string, ProductLicenceEntry[]>
}
