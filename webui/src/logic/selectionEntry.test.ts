import { describe, expect, it } from 'vitest'
import {
  createSelectionEntry,
  getSelection,
  isEnabled,
  migratePersistedSelections,
  partitionSelectionsByLibrary,
  refKey,
  removeSelections,
  upsertSelection,
} from './selectionEntry'
import type { RuleRef, SelectionMap } from './selectionEntry'

const REF_A: RuleRef = { id: 'mscp.os_gatekeeper_enable', path: 'mscp/rules/os_gatekeeper_enable.json' }
const REF_B: RuleRef = { id: 'mscp.os_firewall_enable', path: 'mscp/rules/os_firewall_enable.json' }

describe('refKey', () => {
  it('is the rule id', () => {
    expect(refKey(REF_A)).toBe('mscp.os_gatekeeper_enable')
  })

  it('produces a different key for a different rule', () => {
    expect(refKey(REF_A)).not.toBe(refKey(REF_B))
  })
})

describe('createSelectionEntry', () => {
  it('defaults to not enabled with no ODV value', () => {
    expect(createSelectionEntry(REF_A)).toEqual({ ref: REF_A, enabled: false, odvValue: null })
  })
})

describe('upsertSelection', () => {
  it('creates a fresh entry from the default when none exists', () => {
    const result = upsertSelection({}, REF_A, (entry) => ({ ...entry, enabled: true }))

    expect(result[refKey(REF_A)]).toEqual({ ...createSelectionEntry(REF_A), enabled: true })
  })

  it('applies the updater to the existing entry without touching other entries', () => {
    const existingB = createSelectionEntry(REF_B)
    const initial = { [refKey(REF_A)]: createSelectionEntry(REF_A), [refKey(REF_B)]: existingB }

    const result = upsertSelection(initial, REF_A, (entry) => ({ ...entry, odvValue: 15 }))

    expect(result[refKey(REF_A)].odvValue).toBe(15)
    expect(result[refKey(REF_B)]).toBe(existingB)
  })
})

describe('isEnabled', () => {
  it('is false when no entry exists for the ref', () => {
    expect(isEnabled({}, REF_A)).toBe(false)
  })

  it('reflects the stored entry once one exists', () => {
    const selections = upsertSelection({}, REF_A, (entry) => ({ ...entry, enabled: true }))

    expect(isEnabled(selections, REF_A)).toBe(true)
  })
})

describe('getSelection', () => {
  it('returns a default entry (not stored) when none exists', () => {
    expect(getSelection({}, REF_A)).toEqual(createSelectionEntry(REF_A))
  })

  it('returns the stored entry when one exists', () => {
    const selections = upsertSelection({}, REF_A, (entry) => ({ ...entry, odvValue: 'abc' }))

    expect(getSelection(selections, REF_A).odvValue).toBe('abc')
  })
})

describe('migratePersistedSelections', () => {
  const legacyState = {
    selections: {
      'cis/macos_26_tahoe/v1.1.0/cis_macos26_1.6.json': {
        ref: { family: 'cis', product: 'macos_26_tahoe', version: 'v1.1.0', file: 'cis_macos26_1.6.json', id: '1.6' },
        enabled: true,
        selectedAuditMethodIndex: null,
        organizationDefinedValues: {},
      },
    },
  }

  it('discards version 1 selections', () => {
    expect(migratePersistedSelections(legacyState, 1)).toEqual({ selections: {} })
  })

  it('discards state with no version', () => {
    expect(migratePersistedSelections(legacyState, 0)).toEqual({ selections: {} })
  })

  it('keeps current-version state unchanged', () => {
    const currentState = { selections: { [refKey(REF_A)]: createSelectionEntry(REF_A) } }

    expect(migratePersistedSelections(currentState, 2)).toBe(currentState)
  })
})

describe('partitionSelectionsByLibrary', () => {
  const removedRef: RuleRef = { id: 'mscp.removed_rule', path: 'mscp/rules/removed_rule.json' }
  const renamedRef: RuleRef = { id: 'mscp.zz_renamed_rule', path: 'mscp/rules/zz_renamed_rule.json' }
  const rowsById = new Map([[REF_A.id, { ref: REF_A }], [REF_B.id, { ref: REF_B }]])

  it('keeps enabled selections whose id is in the library and lists the rest as unknown, sorted', () => {
    const selections: SelectionMap = {
      [renamedRef.id]: { ref: renamedRef, enabled: true, odvValue: null },
      [REF_A.id]: { ref: REF_A, enabled: true, odvValue: 'x' },
      [removedRef.id]: { ref: removedRef, enabled: true, odvValue: 12 },
    }

    const result = partitionSelectionsByLibrary(selections, rowsById)

    expect(result.known).toEqual([{ ref: REF_A, enabled: true, odvValue: 'x' }])
    expect(result.unknownIds).toEqual([removedRef.id, renamedRef.id])
  })

  it('ignores disabled selections, known or not', () => {
    const selections: SelectionMap = {
      [REF_A.id]: { ref: REF_A, enabled: false, odvValue: 5 },
      [removedRef.id]: { ref: removedRef, enabled: false, odvValue: 5 },
    }

    expect(partitionSelectionsByLibrary(selections, rowsById)).toEqual({ known: [], unknownIds: [] })
  })

  it("replaces a persisted ref with the library row's ref, so a stale path is never fetched", () => {
    const stalePath: RuleRef = { id: REF_B.id, path: 'mscp/rules/old_location.json' }
    const selections: SelectionMap = { [REF_B.id]: { ref: stalePath, enabled: true, odvValue: null } }

    expect(partitionSelectionsByLibrary(selections, rowsById).known).toEqual([{ ref: REF_B, enabled: true, odvValue: null }])
  })
})

describe('removeSelections', () => {
  it('removes only the given ids and keeps every other entry, ODV values included', () => {
    const removedRef: RuleRef = { id: 'mscp.removed_rule', path: 'mscp/rules/removed_rule.json' }
    const selections: SelectionMap = {
      [REF_A.id]: { ref: REF_A, enabled: true, odvValue: 'kept' },
      [REF_B.id]: { ref: REF_B, enabled: false, odvValue: 7 },
      [removedRef.id]: { ref: removedRef, enabled: true, odvValue: null },
    }

    expect(removeSelections(selections, [removedRef.id])).toEqual({
      [REF_A.id]: { ref: REF_A, enabled: true, odvValue: 'kept' },
      [REF_B.id]: { ref: REF_B, enabled: false, odvValue: 7 },
    })
  })

  it('returns the same map when none of the ids are present', () => {
    const selections: SelectionMap = { [REF_A.id]: { ref: REF_A, enabled: true, odvValue: null } }

    expect(removeSelections(selections, ['mscp.not_there'])).toBe(selections)
  })
})
