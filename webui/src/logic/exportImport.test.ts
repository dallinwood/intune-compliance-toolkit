import { describe, expect, it } from 'vitest'
import { buildSettingsFile, resolveImportedSelections, validateSettingsFile } from './exportImport'
import { createSelectionEntry, refKey, type RuleRef, type SelectionMap } from './selectionEntry'

const REF_A: RuleRef = { id: 'mscp.os_gatekeeper_enable', path: 'mscp/rules/os_gatekeeper_enable.json' }
const REF_B: RuleRef = { id: 'mscp.os_firewall_enable', path: 'mscp/rules/os_firewall_enable.json' }
const RELEASES = { mscp: 'release_27.0' }
const GENERATED_AT = '2026-10-20T00:00:00.000Z'

describe('buildSettingsFile', () => {
  it('wraps every selection entry with a schema version, timestamp and library releases', () => {
    const selections: SelectionMap = {
      [refKey(REF_A)]: { ...createSelectionEntry(REF_A), enabled: true, odvValue: 15 },
    }

    expect(buildSettingsFile(selections, GENERATED_AT, RELEASES)).toEqual({
      schemaVersion: 2,
      generatedAt: GENERATED_AT,
      libraryReleases: RELEASES,
      selections: [{ ref: REF_A, enabled: true, odvValue: 15 }],
    })
  })
})

describe('validateSettingsFile', () => {
  it('round-trips a v2 file through JSON', () => {
    const file = buildSettingsFile(
      {
        [refKey(REF_A)]: { ...createSelectionEntry(REF_A), enabled: true, odvValue: 'text' },
        [refKey(REF_B)]: createSelectionEntry(REF_B),
      },
      GENERATED_AT,
      RELEASES,
    )

    expect(validateSettingsFile(JSON.parse(JSON.stringify(file)))).toEqual({ valid: true, file })
  })

  it('rejects a non-object payload', () => {
    expect(validateSettingsFile('not an object')).toEqual({ valid: false, error: expect.any(String) })
    expect(validateSettingsFile(null)).toEqual({ valid: false, error: expect.any(String) })
  })

  it('rejects a v1 file with the unsupported version message', () => {
    expect(validateSettingsFile({ schemaVersion: 1, generatedAt: 'x', selections: [] })).toEqual({
      valid: false,
      error: 'Unsupported settings schema version: 1.',
    })
  })

  it('rejects a file with no schema version', () => {
    expect(validateSettingsFile({ generatedAt: 'x', selections: [] })).toEqual({
      valid: false,
      error: 'Unsupported settings schema version: undefined.',
    })
  })

  it('rejects a missing libraryReleases', () => {
    const result = validateSettingsFile({ schemaVersion: 2, generatedAt: 'x', selections: [] })
    expect(result.valid).toBe(false)
  })

  it('rejects a selection whose ref lacks a path', () => {
    const result = validateSettingsFile({
      schemaVersion: 2,
      generatedAt: 'x',
      libraryReleases: RELEASES,
      selections: [{ ref: { id: 'mscp.x' }, enabled: true, odvValue: null }],
    })
    expect(result.valid).toBe(false)
  })

  it('rejects an odvValue that is not a string, number or null', () => {
    const result = validateSettingsFile({
      schemaVersion: 2,
      generatedAt: 'x',
      libraryReleases: RELEASES,
      selections: [{ ref: REF_A, enabled: true, odvValue: true }],
    })
    expect(result.valid).toBe(false)
  })
})

describe('resolveImportedSelections', () => {
  it('keeps selections whose id is known', () => {
    const file = buildSettingsFile(
      { [refKey(REF_A)]: { ...createSelectionEntry(REF_A), enabled: true } },
      GENERATED_AT,
      RELEASES,
    )

    const result = resolveImportedSelections(file, new Set([REF_A.id, REF_B.id]))

    expect(result.selections[REF_A.id]).toEqual({ ...createSelectionEntry(REF_A), enabled: true })
    expect(result.unresolvedRefs).toEqual([])
  })

  it('reports unknown ids as unresolved instead of silently dropping them', () => {
    const removedRef: RuleRef = { id: 'mscp.removed_rule', path: 'mscp/rules/removed_rule.json' }
    const file = buildSettingsFile(
      { [refKey(REF_A)]: createSelectionEntry(REF_A), [refKey(removedRef)]: createSelectionEntry(removedRef) },
      GENERATED_AT,
      RELEASES,
    )

    const result = resolveImportedSelections(file, new Set([REF_A.id]))

    expect(Object.keys(result.selections)).toEqual([REF_A.id])
    expect(result.unresolvedRefs).toEqual([removedRef])
  })
})
