import { describe, expect, it } from 'vitest'
import type { Odv, Rule } from '../types/library'
import type { RuleRow } from '../types/rule-row'
import {
  buildSettingsFile,
  importedIdsWithOdvValues,
  resolveImportedSelections,
  sanitizeImportedSelections,
  validateSettingsFile,
} from './exportImport'
import { ODV_VARIABLE_ALLOWLIST } from './odv'
import { createSelectionEntry, refKey, type RuleRef, type SelectionEntry, type SelectionMap } from './selectionEntry'
import { macosCheck } from './testRuleFixtures'

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

describe('sanitizeImportedSelections', () => {
  const PASSWORD_REF: RuleRef = {
    id: 'mscp.pwpolicy_minimum_length_enforce',
    path: 'mscp/rules/pwpolicy_minimum_length_enforce.json',
  }
  const BANNER_REF: RuleRef = {
    id: 'mscp.os_policy_banner_ssh_configure',
    path: 'mscp/rules/os_policy_banner_ssh_configure.json',
  }

  function rowFor(ref: RuleRef): RuleRow {
    return { ref } as RuleRow
  }

  function ruleWith(id: string, odv: Odv | null, checkShell: string): Rule {
    return {
      id,
      odv,
      check: macosCheck({ shell: checkShell, result: null, additional_info: null }),
    } as unknown as Rule
  }

  const numberOdv: Odv = { datatype: 'number', description: 'Length', validation: { min: 1 }, recommended: 6, by_benchmark: {} }
  const bannerOdv: Odv = { datatype: 'string', description: 'Banner', validation: null, recommended: 'x', by_benchmark: {} }

  const rowsById = new Map([REF_A, PASSWORD_REF, BANNER_REF].map((ref) => [ref.id, rowFor(ref)]))
  const rulesById = new Map<string, Rule>([
    [REF_A.id, ruleWith(REF_A.id, null, 'echo pass')],
    [PASSWORD_REF.id, ruleWith(PASSWORD_REF.id, numberOdv, 'test $ODV -gt 0')],
    [BANNER_REF.id, ruleWith(BANNER_REF.id, bannerOdv, ODV_VARIABLE_ALLOWLIST[BANNER_REF.id])],
  ])

  function entry(ref: RuleRef, enabled: boolean, odvValue: SelectionEntry['odvValue']): SelectionEntry {
    return { ref, enabled, odvValue }
  }

  it('rebuilds each ref from the loaded library instead of trusting the imported path', () => {
    const tampered = entry({ id: REF_A.id, path: '../../../evil.json' }, true, null)

    const result = sanitizeImportedSelections([tampered], rowsById, rulesById)

    expect(result.selections).toEqual({ [REF_A.id]: { ref: REF_A, enabled: true, odvValue: null } })
  })

  it('keeps only ref, enabled and odvValue', () => {
    const withExtras = { ...entry(REF_A, true, null), injected: 'x' } as SelectionEntry

    const result = sanitizeImportedSelections([withExtras], rowsById, rulesById)

    expect(Object.keys(result.selections[REF_A.id]).sort()).toEqual(['enabled', 'odvValue', 'ref'])
  })

  it('reports unknown ids and leaves them out', () => {
    const removed = entry({ id: 'mscp.removed_rule', path: 'mscp/rules/removed_rule.json' }, true, null)

    const result = sanitizeImportedSelections([removed, entry(REF_A, true, null)], rowsById, rulesById)

    expect(Object.keys(result.selections)).toEqual([REF_A.id])
    expect(result.unknownIds).toEqual(['mscp.removed_rule'])
  })

  it('stores a valid value in canonical form', () => {
    const result = sanitizeImportedSelections([entry(PASSWORD_REF, true, '015')], rowsById, rulesById)

    expect(result.selections[PASSWORD_REF.id].odvValue).toBe(15)
    expect(result.droppedValues).toEqual([])
  })

  it('drops an invalid value with the reason and keeps the selection', () => {
    const result = sanitizeImportedSelections([entry(PASSWORD_REF, true, '$(reboot)')], rowsById, rulesById)

    expect(result.selections[PASSWORD_REF.id]).toEqual({ ref: PASSWORD_REF, enabled: true, odvValue: null })
    expect(result.droppedValues).toEqual([{ id: PASSWORD_REF.id, reason: 'Value must be a whole number.' }])
  })

  it('drops a value for a rule that has no organization-defined value', () => {
    const result = sanitizeImportedSelections([entry(REF_A, true, 'anything')], rowsById, rulesById)

    expect(result.selections[REF_A.id].odvValue).toBeNull()
    expect(result.droppedValues).toEqual([{ id: REF_A.id, reason: 'This rule has no organization-defined value.' }])
  })

  it('drops a value whose rule details could not be loaded', () => {
    const result = sanitizeImportedSelections([entry(PASSWORD_REF, true, 12)], rowsById, new Map())

    expect(result.selections[PASSWORD_REF.id].odvValue).toBeNull()
    expect(result.droppedValues).toEqual([{ id: PASSWORD_REF.id, reason: 'The rule details could not be loaded.' }])
  })

  it('drops a softwareupdate_current deferral that BSD date -v cannot use', () => {
    const deferralRef: RuleRef = {
      id: 'mscp.system_settings_softwareupdate_current',
      path: 'mscp/rules/system_settings_softwareupdate_current.json',
    }
    const deferralOdv: Odv = { datatype: 'string', description: 'Deferral', validation: null, recommended: '30d', by_benchmark: {} }
    const deferralRows = new Map([[deferralRef.id, rowFor(deferralRef)]])
    const deferralRules = new Map([[deferralRef.id, ruleWith(deferralRef.id, deferralOdv, 'date -v -$ODV "+%s"')]])

    const result = sanitizeImportedSelections(
      [entry(deferralRef, true, '30')],
      deferralRows,
      deferralRules,
    )

    expect(result.selections[deferralRef.id].odvValue).toBeNull()
    expect(result.droppedValues).toEqual([
      {
        id: deferralRef.id,
        reason: 'Value must be a whole number followed by one unit letter (y, m, w, d, H, M or S), for example 30d.',
      },
    ])
  })

  it('trims trailing newlines from a variable-mode banner', () => {
    const result = sanitizeImportedSelections([entry(BANNER_REF, true, "It's ours\n")], rowsById, rulesById)

    expect(result.selections[BANNER_REF.id].odvValue).toBe("It's ours")
  })

  it('lets the last entry win for a duplicated id and reports the duplicate', () => {
    const result = sanitizeImportedSelections(
      [entry(PASSWORD_REF, false, 10), entry(PASSWORD_REF, true, 20)],
      rowsById,
      rulesById,
    )

    expect(result.selections[PASSWORD_REF.id]).toEqual({ ref: PASSWORD_REF, enabled: true, odvValue: 20 })
    expect(result.duplicateIds).toEqual([PASSWORD_REF.id])
  })
})

describe('importedIdsWithOdvValues', () => {
  it('lists known ids that carry a value, once each', () => {
    const rowsById = new Map([[REF_A.id, { ref: REF_A } as RuleRow]])
    const entries: SelectionEntry[] = [
      { ref: REF_A, enabled: true, odvValue: 1 },
      { ref: REF_A, enabled: true, odvValue: 2 },
      { ref: REF_B, enabled: true, odvValue: 3 },
    ]

    expect(importedIdsWithOdvValues(entries, rowsById)).toEqual([REF_A.id])
  })
})
