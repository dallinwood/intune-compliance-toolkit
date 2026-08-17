import { describe, expect, it } from 'vitest'
import { buildSettingsFile, resolveImportedSelections, validateSettingsFile } from './exportImport'
import { createSelectionEntry, refKey, type RuleRef, type SelectionMap } from './selectionEntry'

const REF_A: RuleRef = { family: 'cis', product: 'macos_26_tahoe', version: 'v1.1.0', file: 'cis_macos26_1.6.json', id: '1.6' }
const REF_B: RuleRef = { family: 'cis', product: 'macos_26_tahoe', version: 'v1.1.0', file: 'cis_macos26_2.1.1.1.json', id: '2.1.1.1' }

describe('buildSettingsFile', () => {
  it('wraps every selection entry with a schema version and timestamp', () => {
    const selections: SelectionMap = {
      [refKey(REF_A)]: { ...createSelectionEntry(REF_A), enabled: true },
    }

    const file = buildSettingsFile(selections, '2026-08-17T00:00:00.000Z')

    expect(file).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-08-17T00:00:00.000Z',
      selections: [{ ...createSelectionEntry(REF_A), enabled: true }],
    })
  })
})

describe('validateSettingsFile', () => {
  it('accepts a well-formed file', () => {
    const file = buildSettingsFile({ [refKey(REF_A)]: createSelectionEntry(REF_A) }, '2026-08-17T00:00:00.000Z')

    const result = validateSettingsFile(JSON.parse(JSON.stringify(file)))

    expect(result).toEqual({ valid: true, file })
  })

  it('rejects a non-object payload', () => {
    expect(validateSettingsFile('not an object')).toEqual({
      valid: false,
      error: expect.any(String),
    })
    expect(validateSettingsFile(null)).toEqual({ valid: false, error: expect.any(String) })
  })

  it('rejects an unsupported schema version', () => {
    const result = validateSettingsFile({ schemaVersion: 2, generatedAt: 'x', selections: [] })

    expect(result.valid).toBe(false)
  })

  it('rejects a selections entry missing a required ref field', () => {
    const result = validateSettingsFile({
      schemaVersion: 1,
      generatedAt: 'x',
      selections: [
        {
          ref: { family: 'cis', product: 'macos_26_tahoe', version: 'v1.1.0' /* missing file, id */ },
          enabled: true,
          selectedAuditMethodIndex: null,
          organizationDefinedValues: {},
        },
      ],
    })

    expect(result.valid).toBe(false)
  })

  it('rejects an organization-defined value that is not a string, number, or boolean', () => {
    const result = validateSettingsFile({
      schemaVersion: 1,
      generatedAt: 'x',
      selections: [
        {
          ref: REF_A,
          enabled: true,
          selectedAuditMethodIndex: null,
          organizationDefinedValues: { some_var: { nested: 'object' } },
        },
      ],
    })

    expect(result.valid).toBe(false)
  })
})

describe('resolveImportedSelections', () => {
  it('keeps selections whose ref resolves against the known rule set', () => {
    const file = buildSettingsFile(
      { [refKey(REF_A)]: { ...createSelectionEntry(REF_A), enabled: true } },
      '2026-08-17T00:00:00.000Z',
    )

    const result = resolveImportedSelections(file, new Set([refKey(REF_A), refKey(REF_B)]))

    expect(result.selections[refKey(REF_A)]).toEqual({ ...createSelectionEntry(REF_A), enabled: true })
    expect(result.unresolvedRefs).toEqual([])
  })

  it('reports refs that no longer resolve instead of silently dropping them', () => {
    const removedRef: RuleRef = { ...REF_A, file: 'cis_macos26_removed.json', id: '9.9' }
    const file = buildSettingsFile(
      {
        [refKey(REF_A)]: createSelectionEntry(REF_A),
        [refKey(removedRef)]: createSelectionEntry(removedRef),
      },
      '2026-08-17T00:00:00.000Z',
    )

    const result = resolveImportedSelections(file, new Set([refKey(REF_A)]))

    expect(Object.keys(result.selections)).toEqual([refKey(REF_A)])
    expect(result.unresolvedRefs).toEqual([removedRef])
  })
})
