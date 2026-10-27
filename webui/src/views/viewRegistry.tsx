import type { ReactNode } from 'react'
import { DEFAULT_VIEW_ID } from '../state/urlState'
import { LicencesView } from './LicencesView'
import { RulesView } from './RulesView'
import type { ViewContext } from './viewContext'

export interface ViewDefinition {
  id: string
  label: string
  render: (context: ViewContext) => ReactNode
}

// Tab order. Adding a view is one entry here plus its component. The first
// entry must be DEFAULT_VIEW_ID, which the URL leaves out.
export const VIEWS: readonly ViewDefinition[] = [
  { id: DEFAULT_VIEW_ID, label: 'Rules', render: (context) => <RulesView {...context} /> },
  { id: 'licences', label: 'Licences', render: () => <LicencesView /> },
]

export function resolveView(id: string, views: readonly ViewDefinition[] = VIEWS): ViewDefinition {
  return views.find((view) => view.id === id) ?? views[0]
}
