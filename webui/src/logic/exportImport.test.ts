import { describe, expect, it } from 'vitest'
import type { Odv, Rule } from '../types/library'
import type { RuleRow } from '../types/rule-row'
import {
  buildSettingsFile,
  importedIdsWithOdvValues,
  parseSupportingCheckChoices,
  resolveImportedSelections,
  sanitizeImportedSelections,
  validateSettingsFile,
} from './exportImport'
import { ODV_VARIABLE_ALLOWLIST } from './odv'
import { createSelectionEntry, refKey, type RuleRef, type SelectionEntry, type SelectionMap } from './selectionEntry'
import type { SupportingCheckChoices } from './supportingChecks'
import { macosCheck, numberOdv as numberOdvFixture } from './testRuleFixtures'

const REF_A: RuleRef = { id: 'mscp.os_gatekeeper_enable', path: 'mscp/rules/os_gatekeeper_enable.json' }
const REF_B: RuleRef = { id: 'mscp.os_firewall_enable', path: 'mscp/rules/os_firewall_enable.json' }
const RELEASES = { mscp: 'release_27.0' }
const GENERATED_AT = '2026-10-20T00:00:00.000Z'

describe('buildSettingsFile', () => {
  it('wraps every selection entry with a schema version, timestamp and library releases', () => {
    const selections: SelectionMap = {
      [refKey(REF_A)]: { ...createSelectionEntry(REF_A), enabled: true, odvValues: { value: 15 } },
    }

    expect(buildSettingsFile(selections, GENERATED_AT, RELEASES)).toEqual({
      schemaVersion: 3,
      generatedAt: GENERATED_AT,
      libraryReleases: RELEASES,
      selections: [{ ref: REF_A, enabled: true, odvValues: { value: 15 } }],
    })
  })
})

describe('validateSettingsFile', () => {
  it('round-trips a v3 file through JSON', () => {
    const file = buildSettingsFile(
      {
        [refKey(REF_A)]: { ...createSelectionEntry(REF_A), enabled: true, odvValues: { value: 'text', other: 3 } },
        [refKey(REF_B)]: createSelectionEntry(REF_B),
      },
      GENERATED_AT,
      RELEASES,
    )

    expect(validateSettingsFile(JSON.parse(JSON.stringify(file)))).toEqual({ valid: true, file, warnings: [] })
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
    const result = validateSettingsFile({ schemaVersion: 3, generatedAt: 'x', selections: [] })
    expect(result.valid).toBe(false)
  })

  it('rejects a selection whose ref lacks a path', () => {
    const result = validateSettingsFile({
      schemaVersion: 3,
      generatedAt: 'x',
      libraryReleases: RELEASES,
      selections: [{ ref: { id: 'mscp.x' }, enabled: true, odvValues: {} }],
    })
    expect(result.valid).toBe(false)
  })

  it('rejects an odvValues value that is not a string or number', () => {
    const result = validateSettingsFile({
      schemaVersion: 3,
      generatedAt: 'x',
      libraryReleases: RELEASES,
      selections: [{ ref: REF_A, enabled: true, odvValues: { value: true } }],
    })
    expect(result.valid).toBe(false)
  })

  it('rejects odvValues that is not an object', () => {
    for (const odvValues of [null, [], 5, undefined]) {
      const result = validateSettingsFile({
        schemaVersion: 3,
        generatedAt: 'x',
        libraryReleases: RELEASES,
        selections: [{ ref: REF_A, enabled: true, odvValues }],
      })
      expect(result.valid).toBe(false)
    }
  })

  it('rejects a v3 file whose entries still use odvValue', () => {
    const result = validateSettingsFile({
      schemaVersion: 3,
      generatedAt: 'x',
      libraryReleases: RELEASES,
      selections: [{ ref: REF_A, enabled: true, odvValue: 5 }],
    })
    expect(result.valid).toBe(false)
  })
})

describe('validateSettingsFile with a v2 file', () => {
  function version2File(selections: unknown[]) {
    return { schemaVersion: 2, generatedAt: GENERATED_AT, libraryReleases: RELEASES, selections }
  }

  it('converts each odvValue to the ODV named value', () => {
    const result = validateSettingsFile(
      version2File([
        { ref: REF_A, enabled: true, odvValue: 15 },
        { ref: REF_B, enabled: false, odvValue: 'text' },
        { ref: { id: 'mscp.c', path: 'mscp/c.json' }, enabled: true, odvValue: null },
      ]),
    )

    expect(result).toEqual({
      valid: true,
      file: {
        schemaVersion: 3,
        generatedAt: GENERATED_AT,
        libraryReleases: RELEASES,
        selections: [
          { ref: REF_A, enabled: true, odvValues: { value: 15 } },
          { ref: REF_B, enabled: false, odvValues: { value: 'text' } },
          { ref: { id: 'mscp.c', path: 'mscp/c.json' }, enabled: true, odvValues: {} },
        ],
      },
      warnings: [],
    })
  })

  it('rejects a v2 entry whose odvValue is not a string, number or null', () => {
    expect(validateSettingsFile(version2File([{ ref: REF_A, enabled: true, odvValue: true }])).valid).toBe(false)
  })

  it('rejects a v2 entry that already uses odvValues', () => {
    expect(validateSettingsFile(version2File([{ ref: REF_A, enabled: true, odvValues: {} }])).valid).toBe(false)
  })

  it('keeps supporting check choices', () => {
    const result = validateSettingsFile({
      ...version2File([]),
      supportingChecks: { includeSupporting: true, overrides: {} },
    })

    expect(result).toMatchObject({ valid: true, file: { schemaVersion: 3, supportingChecks: { includeSupporting: true, overrides: {} } } })
  })
})

const SUPPORTING_CHOICES: SupportingCheckChoices = {
  includeSupporting: true,
  overrides: { 'mscp.os_firewall_enable': 'exclude', 'mscp.os_gatekeeper_enable': 'include' },
}
const UNREADABLE_WARNING = 'Supporting check choices in this file were not readable and were reset to the defaults.'

describe('supporting check choices in a settings file', () => {
  it('omits the field when no choices are given', () => {
    expect(buildSettingsFile({}, GENERATED_AT, RELEASES)).not.toHaveProperty('supportingChecks')
  })

  it('round-trips the choices through JSON', () => {
    const file = buildSettingsFile({}, GENERATED_AT, RELEASES, SUPPORTING_CHOICES)
    expect(validateSettingsFile(JSON.parse(JSON.stringify(file)))).toEqual({ valid: true, file, warnings: [] })
  })

  it('imports a file exported before supporting checks existed, without the field or a warning', () => {
    const oldFormatFile = {
      schemaVersion: 3,
      generatedAt: '2026-10-20T00:00:00.000Z',
      libraryReleases: { mscp: 'release_27.0' },
      selections: [{ ref: REF_A, enabled: true, odvValues: { value: 15 } }],
    }
    expect(validateSettingsFile(oldFormatFile)).toEqual({ valid: true, file: oldFormatFile, warnings: [] })
  })

  it('drops malformed choices with a warning and still accepts the file', () => {
    const result = validateSettingsFile({
      schemaVersion: 3,
      generatedAt: GENERATED_AT,
      libraryReleases: RELEASES,
      selections: [],
      supportingChecks: { includeSupporting: 'yes', overrides: {} },
    })
    expect(result).toEqual({
      valid: true,
      file: { schemaVersion: 3, generatedAt: GENERATED_AT, libraryReleases: RELEASES, selections: [] },
      warnings: [UNREADABLE_WARNING],
    })
  })

  it('keeps a disabled entry with an organization-defined value through export, validate and sanitize', () => {
    const passwordRef: RuleRef = { id: 'mscp.pwpolicy_minimum_length_enforce', path: 'mscp/rules/pwpolicy_minimum_length_enforce.json' }
    const rule = {
      id: passwordRef.id,
      odvs: [numberOdvFixture()],
      check: macosCheck({ shell: 'test $ODV_value -gt 0', result: null, additional_info: null }),
    } as unknown as Rule
    const exported = buildSettingsFile(
      { [refKey(passwordRef)]: { ref: passwordRef, enabled: false, odvValues: { value: 12 } } },
      GENERATED_AT,
      RELEASES,
      SUPPORTING_CHOICES,
    )

    const validation = validateSettingsFile(JSON.parse(JSON.stringify(exported)))
    if (!validation.valid) throw new Error(validation.error)
    const result = sanitizeImportedSelections(
      validation.file.selections,
      new Map([[passwordRef.id, { ref: passwordRef } as RuleRow]]),
      new Map([[passwordRef.id, rule]]),
    )

    expect(result.selections[refKey(passwordRef)]).toEqual({ ref: passwordRef, enabled: false, odvValues: { value: 12 } })
    expect(result.droppedValues).toEqual([])
  })
})

describe('parseSupportingCheckChoices', () => {
  it('accepts well-formed choices', () => {
    expect(parseSupportingCheckChoices(SUPPORTING_CHOICES)).toEqual(SUPPORTING_CHOICES)
  })

  it('rejects a non-boolean includeSupporting', () => {
    expect(parseSupportingCheckChoices({ includeSupporting: 1, overrides: {} })).toBeNull()
  })

  it('rejects an unknown override value', () => {
    expect(parseSupportingCheckChoices({ includeSupporting: true, overrides: { 'mscp.a': 'maybe' } })).toBeNull()
  })

  it('rejects missing or non-object overrides and non-object input', () => {
    expect(parseSupportingCheckChoices({ includeSupporting: true })).toBeNull()
    expect(parseSupportingCheckChoices({ includeSupporting: true, overrides: [] })).toBeNull()
    expect(parseSupportingCheckChoices(null)).toBeNull()
    expect(parseSupportingCheckChoices('text')).toBeNull()
  })

  it('copies only known keys', () => {
    expect(parseSupportingCheckChoices({ includeSupporting: false, overrides: {}, extra: 1 })).toEqual({
      includeSupporting: false,
      overrides: {},
    })
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

  function ruleWith(id: string, odvs: Odv[], checkShell: string): Rule {
    return {
      id,
      odvs,
      check: macosCheck({ shell: checkShell, result: null, additional_info: null }),
    } as unknown as Rule
  }

  const numberOdv = numberOdvFixture({ description: 'Length' })
  const bannerOdv = numberOdvFixture({ datatype: 'string', description: 'Banner', validation: null, recommended: 'x' })

  const rowsById = new Map([REF_A, PASSWORD_REF, BANNER_REF].map((ref) => [ref.id, rowFor(ref)]))
  const rulesById = new Map<string, Rule>([
    [REF_A.id, ruleWith(REF_A.id, [], 'echo pass')],
    [PASSWORD_REF.id, ruleWith(PASSWORD_REF.id, [numberOdv], 'test $ODV_value -gt 0')],
    [BANNER_REF.id, ruleWith(BANNER_REF.id, [bannerOdv], ODV_VARIABLE_ALLOWLIST[`${BANNER_REF.id}:value`])],
  ])

  function entry(ref: RuleRef, enabled: boolean, odvValues: SelectionEntry['odvValues'] = {}): SelectionEntry {
    return { ref, enabled, odvValues }
  }

  it('rebuilds each ref from the loaded library instead of trusting the imported path', () => {
    const tampered = entry({ id: REF_A.id, path: '../../../evil.json' }, true)

    const result = sanitizeImportedSelections([tampered], rowsById, rulesById)

    expect(result.selections).toEqual({ [REF_A.id]: { ref: REF_A, enabled: true, odvValues: {} } })
  })

  it('keeps only ref, enabled and odvValues', () => {
    const withExtras = { ...entry(REF_A, true), injected: 'x' } as SelectionEntry

    const result = sanitizeImportedSelections([withExtras], rowsById, rulesById)

    expect(Object.keys(result.selections[REF_A.id]).sort()).toEqual(['enabled', 'odvValues', 'ref'])
  })

  it('reports unknown ids and leaves them out', () => {
    const removed = entry({ id: 'mscp.removed_rule', path: 'mscp/rules/removed_rule.json' }, true)

    const result = sanitizeImportedSelections([removed, entry(REF_A, true)], rowsById, rulesById)

    expect(Object.keys(result.selections)).toEqual([REF_A.id])
    expect(result.unknownIds).toEqual(['mscp.removed_rule'])
  })

  it('stores a valid value in canonical form', () => {
    const result = sanitizeImportedSelections([entry(PASSWORD_REF, true, { value: '015' })], rowsById, rulesById)

    expect(result.selections[PASSWORD_REF.id].odvValues).toEqual({ value: 15 })
    expect(result.droppedValues).toEqual([])
  })

  it('drops an invalid value with the reason and keeps the selection', () => {
    const result = sanitizeImportedSelections([entry(PASSWORD_REF, true, { value: '$(reboot)' })], rowsById, rulesById)

    expect(result.selections[PASSWORD_REF.id]).toEqual({ ref: PASSWORD_REF, enabled: true, odvValues: {} })
    expect(result.droppedValues).toEqual([{ id: PASSWORD_REF.id, reason: 'value: Value must be a whole number.' }])
  })

  it('drops a value for a rule that has no organization-defined value of that name', () => {
    const result = sanitizeImportedSelections([entry(REF_A, true, { value: 'anything' })], rowsById, rulesById)

    expect(result.selections[REF_A.id].odvValues).toEqual({})
    expect(result.droppedValues).toEqual([{ id: REF_A.id, reason: 'This rule has no organization-defined value named value.' }])
  })

  it('drops an unknown ODV name but keeps the valid ones, naming it in the reason', () => {
    const result = sanitizeImportedSelections([entry(PASSWORD_REF, true, { value: 12, length: 3 })], rowsById, rulesById)

    expect(result.selections[PASSWORD_REF.id].odvValues).toEqual({ value: 12 })
    expect(result.droppedValues).toEqual([{ id: PASSWORD_REF.id, reason: 'This rule has no organization-defined value named length.' }])
  })

  it('validates each name against its own ODV', () => {
    const labelOdv = numberOdvFixture({ name: 'label', datatype: 'string', validation: null, recommended: 'ab' })
    const twoOdvRules = new Map([[PASSWORD_REF.id, ruleWith(PASSWORD_REF.id, [numberOdv, labelOdv], 'test $ODV_value -gt 0')]])

    const result = sanitizeImportedSelections([entry(PASSWORD_REF, true, { value: '015', label: 'x y' })], rowsById, twoOdvRules)

    expect(result.selections[PASSWORD_REF.id].odvValues).toEqual({ value: 15, label: 'x y' })
    expect(result.droppedValues).toEqual([])
  })

  it('drops a value whose rule details could not be loaded', () => {
    const result = sanitizeImportedSelections([entry(PASSWORD_REF, true, { value: 12 })], rowsById, new Map())

    expect(result.selections[PASSWORD_REF.id].odvValues).toEqual({})
    expect(result.droppedValues).toEqual([{ id: PASSWORD_REF.id, reason: 'The rule details could not be loaded.' }])
  })

  it('drops a softwareupdate_current deferral that BSD date -v cannot use', () => {
    const deferralRef: RuleRef = {
      id: 'mscp.system_settings_softwareupdate_current',
      path: 'mscp/rules/system_settings_softwareupdate_current.json',
    }
    const deferralOdv = numberOdvFixture({ datatype: 'string', description: 'Deferral', validation: null, recommended: '30d' })
    const deferralRows = new Map([[deferralRef.id, rowFor(deferralRef)]])
    const deferralRules = new Map([[deferralRef.id, ruleWith(deferralRef.id, [deferralOdv], 'date -v -$ODV_value "+%s"')]])

    const result = sanitizeImportedSelections(
      [entry(deferralRef, true, { value: '30' })],
      deferralRows,
      deferralRules,
    )

    expect(result.selections[deferralRef.id].odvValues).toEqual({})
    expect(result.droppedValues).toEqual([
      {
        id: deferralRef.id,
        reason: 'value: Value must be a whole number followed by one unit letter (y, m, w, d, H, M or S), for example 30d.',
      },
    ])
  })

  it('trims trailing newlines from a variable-mode banner', () => {
    const result = sanitizeImportedSelections([entry(BANNER_REF, true, { value: "It's ours\n" })], rowsById, rulesById)

    expect(result.selections[BANNER_REF.id].odvValues).toEqual({ value: "It's ours" })
  })

  it('lets the last entry win for a duplicated id and reports the duplicate', () => {
    const result = sanitizeImportedSelections(
      [entry(PASSWORD_REF, false, { value: 10 }), entry(PASSWORD_REF, true, { value: 20 })],
      rowsById,
      rulesById,
    )

    expect(result.selections[PASSWORD_REF.id]).toEqual({ ref: PASSWORD_REF, enabled: true, odvValues: { value: 20 } })
    expect(result.duplicateIds).toEqual([PASSWORD_REF.id])
  })
})

describe('importedIdsWithOdvValues', () => {
  it('lists known ids that carry a value, once each', () => {
    const rowsById = new Map([[REF_A.id, { ref: REF_A } as RuleRow]])
    const entries: SelectionEntry[] = [
      { ref: REF_A, enabled: true, odvValues: { value: 1 } },
      { ref: REF_A, enabled: true, odvValues: { value: 2 } },
      { ref: REF_B, enabled: true, odvValues: { value: 3 } },
      { ref: REF_A, enabled: true, odvValues: {} },
    ]

    expect(importedIdsWithOdvValues(entries, rowsById)).toEqual([REF_A.id])
  })
})
