export type Availability = 'included' | 'add_on' | 'package_feature'

export interface CatalogPlan {
  id: string
  title: string
  description: string | null
  features: string[]
}

export interface CatalogVendor {
  id: string
  title: string
  url: string | null
}

export interface CatalogLink {
  title: string
  url: string
}

export interface CatalogProduct {
  id: string
  title: string
  vendor: string
  parent: string | null
  category: string | null
  description: string | null
  links: CatalogLink[]
  targets: string[]
  plans: CatalogPlan[]
}

export interface CatalogInclusion {
  product: string
  plan?: string
  custom_plan?: { title: string; description: string | null }
  availability: Availability
  note: string | null
}

export interface CatalogLicence {
  id: string
  title: string
  vendor: string
  family: string
  kind: 'subscription' | 'add_on'
  requires: string[]
  description: string | null
  links: CatalogLink[]
  includes: CatalogInclusion[]
  review: string[]
}

export interface ProductLicenceEntry {
  licence: string
  availability: Availability
  // Full plan id (`<product id>.<plan id>`) when the licence lists a plan of this product.
  planId: string | null
  customPlanTitle: string | null
  via: 'direct' | 'plan'
  // Full id of the plan that brings this product in, when via is 'plan'.
  viaPlanId: string | null
  note: string | null
}

export interface CatalogIndex {
  schema_version: 1
  vendors: CatalogVendor[]
  products: CatalogProduct[]
  licences: CatalogLicence[]
  by_product: Record<string, ProductLicenceEntry[]>
}
