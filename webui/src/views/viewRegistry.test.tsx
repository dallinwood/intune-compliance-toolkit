import { describe, expect, it } from 'vitest'
import { DEFAULT_VIEW_ID } from '../state/urlState'
import { resolveView, VIEWS, type ViewDefinition } from './viewRegistry'

describe('viewRegistry', () => {
  it('lists the default view first with unique ids and labels', () => {
    expect(VIEWS[0].id).toBe(DEFAULT_VIEW_ID)
    expect(VIEWS.map((view) => view.label)).toContain('Rules')
    expect(new Set(VIEWS.map((view) => view.id)).size).toBe(VIEWS.length)
  })

  it('resolves a known id to its view and an unknown id to the first view', () => {
    const second: ViewDefinition = { id: 'reports', label: 'Reports', render: () => null }
    const views = [...VIEWS, second]
    expect(resolveView('reports', views)).toBe(second)
    expect(resolveView('nonsense', views)).toBe(VIEWS[0])
    expect(resolveView('')).toBe(VIEWS[0])
  })
})
