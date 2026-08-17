import { describe, expect, it } from 'vitest'
import { createSelectionEntry, getSelection, isEnabled, refKey, upsertSelection } from './selectionEntry'
import type { RuleRef } from './selectionEntry'

const REF_A: RuleRef = { family: 'cis', product: 'macos_26_tahoe', version: 'v1.1.0', file: 'cis_macos26_1.6.json', id: '1.6' }
const REF_B: RuleRef = { ...REF_A, file: 'cis_macos26_2.1.1.1.json', id: '2.1.1.1' }

describe('refKey', () => {
  it('produces the same key for identical refs', () => {
    expect(refKey(REF_A)).toBe(refKey({ ...REF_A }))
  })

  it('produces a different key when the file differs', () => {
    expect(refKey(REF_A)).not.toBe(refKey(REF_B))
  })
})

describe('createSelectionEntry', () => {
  it('defaults to not enabled, first methods, and no organization-defined values', () => {
    const entry = createSelectionEntry(REF_A)

    expect(entry).toEqual({
      ref: REF_A,
      enabled: false,
      selectedAuditMethodIndex: 0,
      selectedRemediationMethodIndex: 0,
      organizationDefinedValues: {},
    })
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

    const result = upsertSelection(initial, REF_A, (entry) => ({ ...entry, selectedAuditMethodIndex: 1 }))

    expect(result[refKey(REF_A)].selectedAuditMethodIndex).toBe(1)
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
    const selections = upsertSelection({}, REF_A, (entry) => ({ ...entry, selectedRemediationMethodIndex: 2 }))

    expect(getSelection(selections, REF_A).selectedRemediationMethodIndex).toBe(2)
  })
})
