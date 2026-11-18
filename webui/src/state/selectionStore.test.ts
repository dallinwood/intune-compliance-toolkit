import { beforeEach, describe, expect, it, vi } from 'vitest'

// The store persists to localStorage, which the node test environment lacks.
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
const { useSelectionStore } = await import('./selectionStore')

const firstRef = { id: 'mscp.a', path: 'mscp/a.json' }
const secondRef = { id: 'mscp.b', path: 'mscp/b.json' }

describe('setEnabledMany', () => {
  beforeEach(() => useSelectionStore.setState({ selections: {} }))

  it('enables every ref in one update and keeps an existing odvValue', () => {
    useSelectionStore.getState().setOdvValue(firstRef, 5)
    let updateCount = 0
    const unsubscribe = useSelectionStore.subscribe(() => (updateCount += 1))
    useSelectionStore.getState().setEnabledMany([firstRef, secondRef], true)
    unsubscribe()
    const { selections } = useSelectionStore.getState()
    expect(selections[firstRef.id]).toMatchObject({ enabled: true, odvValue: 5 })
    expect(selections[secondRef.id].enabled).toBe(true)
    expect(updateCount).toBe(1)
  })

  it('disables the refs but keeps their odvValue', () => {
    useSelectionStore.getState().setOdvValue(firstRef, 5)
    useSelectionStore.getState().setEnabledMany([firstRef], true)
    useSelectionStore.getState().setEnabledMany([firstRef], false)
    expect(useSelectionStore.getState().selections[firstRef.id]).toMatchObject({ enabled: false, odvValue: 5 })
  })
})
