import { beforeEach, describe, expect, it, vi } from 'vitest'

// The store persists to localStorage, which the node test environment lacks.
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
const { useSelectionStore } = await import('./selectionStore')

const firstRef = { id: 'mscp.a', path: 'mscp/a.json' }
const secondRef = { id: 'mscp.b', path: 'mscp/b.json' }

describe('setEnabledMany', () => {
  beforeEach(() => useSelectionStore.setState({ selections: {} }))

  it('enables every ref in one update and keeps existing ODV values', () => {
    useSelectionStore.getState().setOdvValue(firstRef, 'value', 5)
    let updateCount = 0
    const unsubscribe = useSelectionStore.subscribe(() => (updateCount += 1))
    useSelectionStore.getState().setEnabledMany([firstRef, secondRef], true)
    unsubscribe()
    const { selections } = useSelectionStore.getState()
    expect(selections[firstRef.id]).toMatchObject({ enabled: true, odvValues: { value: 5 } })
    expect(selections[secondRef.id].enabled).toBe(true)
    expect(updateCount).toBe(1)
  })

  it('disables the refs but keeps their ODV values', () => {
    useSelectionStore.getState().setOdvValue(firstRef, 'value', 5)
    useSelectionStore.getState().setEnabledMany([firstRef], true)
    useSelectionStore.getState().setEnabledMany([firstRef], false)
    expect(useSelectionStore.getState().selections[firstRef.id]).toMatchObject({ enabled: false, odvValues: { value: 5 } })
  })
})

describe('setOdvValue and clearOdvValue', () => {
  beforeEach(() => useSelectionStore.setState({ selections: {} }))

  it('sets each named value on its own, keeping the others', () => {
    useSelectionStore.getState().setOdvValue(firstRef, 'length', 12)
    useSelectionStore.getState().setOdvValue(firstRef, 'label', 'x')
    useSelectionStore.getState().setOdvValue(firstRef, 'length', 14)
    expect(useSelectionStore.getState().selections[firstRef.id].odvValues).toEqual({ length: 14, label: 'x' })
  })

  it('clears only the named value', () => {
    useSelectionStore.getState().setOdvValue(firstRef, 'length', 12)
    useSelectionStore.getState().setOdvValue(firstRef, 'label', 'x')
    useSelectionStore.getState().clearOdvValue(firstRef, 'length')
    expect(useSelectionStore.getState().selections[firstRef.id].odvValues).toEqual({ label: 'x' })
  })
})
