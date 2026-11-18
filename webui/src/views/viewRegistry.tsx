import type { ReactNode } from 'react'
import { DEFAULT_VIEW_ID } from '../state/urlState'
import { FrameworksView } from './FrameworksView'
import { LicencesView } from './LicencesView'
import { ProductsView } from './ProductsView'
import type { ViewContext } from './viewContext'

export interface ViewDefinition {
  id: string
  label: string
  render: (context: ViewContext) => ReactNode
}

// Tab order. Adding a view is one entry here plus its component, and its id
// in scripts/route-pages.mjs (a test keeps the two in step). The first entry
// must be DEFAULT_VIEW_ID, the view a bare base address shows; its own
// address is written out as /frameworks.
export const VIEWS: readonly ViewDefinition[] = [
  { id: DEFAULT_VIEW_ID, label: 'Frameworks', render: (context) => <FrameworksView {...context} /> },
  { id: 'licences', label: 'Licences', render: () => <LicencesView /> },
  { id: 'products', label: 'Products', render: () => <ProductsView /> },
]

// Views merged into Frameworks. Their pages are still emitted so old links
// load the app, which rewrites them (see migrateLegacyView).
export const LEGACY_VIEW_IDS: readonly string[] = ['rules', 'coverage']

export function resolveView(id: string, views: readonly ViewDefinition[] = VIEWS): ViewDefinition {
  return views.find((view) => view.id === id) ?? views[0]
}
