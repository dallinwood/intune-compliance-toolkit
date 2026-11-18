import { describe, expect, it } from 'vitest'
import { selectAllState } from './selectAll'
import { createSelectionEntry, upsertSelection, type RuleRef, type SelectionMap } from './selectionEntry'

const firstRef: RuleRef = { id: 'mscp.a', path: 'mscp/a.json' }
const secondRef: RuleRef = { id: 'mscp.b', path: 'mscp/b.json' }

function enabledSelections(...refs: RuleRef[]): SelectionMap {
  return refs.reduce<SelectionMap>((selections, ref) => upsertSelection(selections, ref, (entry) => ({ ...entry, enabled: true })), {})
}

describe('selectAllState', () => {
  it('is checked when every visible rule is enabled', () => {
    expect(selectAllState([firstRef, secondRef], enabledSelections(firstRef, secondRef))).toBe('checked')
  })

  it('is unchecked when none is enabled', () => {
    expect(selectAllState([firstRef, secondRef], {})).toBe('unchecked')
  })

  it('is indeterminate when some are enabled', () => {
    expect(selectAllState([firstRef, secondRef], enabledSelections(firstRef))).toBe('indeterminate')
  })

  it('does not count an entry that exists but is disabled', () => {
    const selections = { [firstRef.id]: createSelectionEntry(firstRef) }
    expect(selectAllState([firstRef], selections)).toBe('unchecked')
  })

  it('ignores enabled rules outside the visible refs', () => {
    expect(selectAllState([firstRef], enabledSelections(secondRef))).toBe('unchecked')
  })

  it('is unchecked for an empty view', () => {
    expect(selectAllState([], enabledSelections(firstRef))).toBe('unchecked')
  })
})
