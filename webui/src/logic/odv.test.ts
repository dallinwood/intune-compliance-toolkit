import { describe, expect, it } from 'vitest'
import type { Odv, Rule } from '../types/library'
import {
  canonicalOdvValue,
  containsOdvPlaceholder,
  displayWithOdv,
  effectiveOdvValue,
  odvQuickPicks,
  odvSubstitutionMode,
  ODV_RULE_VALUE_PATTERNS,
  ODV_VARIABLE_ALLOWLIST,
  prepareOdvValue,
  substituteOdv,
  usableOdvValue,
  validateOdvValue,
} from './odv'
import { committedVocabularyIndex, vocabularyIndexOf } from './testVocabularyFixtures'

const GENERIC_RULE_ID = 'mscp.example_rule'
const vocabularyIndex = committedVocabularyIndex()

function odv(overrides: Partial<Odv> = {}): Odv {
  return {
    datatype: 'number',
    description: 'Example',
    validation: null,
    recommended: 6,
    by_benchmark: {},
    ...overrides,
  }
}

describe('odvSubstitutionMode', () => {
  const allowlistedId = 'mscp.os_policy_banner_ssh_configure'
  const allowlistedShell = ODV_VARIABLE_ALLOWLIST[allowlistedId]

  function ruleWithChecks(id: string, defaultShell: string | null, byVersionShells: Record<string, string> = {}): Rule {
    const checkOf = (shell: string) => ({ shell, result: null, additional_info: null })
    return {
      id,
      check: {
        default: defaultShell === null ? null : checkOf(defaultShell),
        by_version: Object.fromEntries(Object.entries(byVersionShells).map(([version, shell]) => [version, checkOf(shell)])),
      },
      discussion: 'Mentions $ODV here but that is ignored',
    } as unknown as Rule
  }

  it('is none when no check shell mentions $ODV', () => {
    expect(odvSubstitutionMode(ruleWithChecks('mscp.x', '/usr/bin/defaults read com.apple.foo'))).toBe('none')
  })

  it('is none when the rule has no check', () => {
    expect(odvSubstitutionMode({ id: 'mscp.x', check: null } as unknown as Rule)).toBe('none')
    expect(odvSubstitutionMode(ruleWithChecks('mscp.x', null))).toBe('none')
  })

  it('is variable for an allowlisted rule whose shell is exactly the reviewed text', () => {
    expect(odvSubstitutionMode(ruleWithChecks(allowlistedId, allowlistedShell))).toBe('variable')
  })

  it('is text for an allowlisted rule whose shell was modified', () => {
    expect(odvSubstitutionMode(ruleWithChecks(allowlistedId, `${allowlistedShell}; id`))).toBe('text')
  })

  it('is text when any by_version shell with $ODV differs from the reviewed text', () => {
    expect(odvSubstitutionMode(ruleWithChecks(allowlistedId, allowlistedShell, { '26.0': 'echo $ODV' }))).toBe('text')
  })

  it('is variable when the same reviewed text is repeated in a by_version shell', () => {
    expect(odvSubstitutionMode(ruleWithChecks(allowlistedId, allowlistedShell, { '26.0': allowlistedShell }))).toBe('variable')
  })

  it('is text for a non-allowlisted rule even if it looks safe', () => {
    expect(odvSubstitutionMode(ruleWithChecks('mscp.other_rule', 'bannerText="$ODV"'))).toBe('text')
  })

  it('is text for a non-allowlisted rule that reuses the allowlisted shell text', () => {
    expect(odvSubstitutionMode(ruleWithChecks('mscp.other_rule', allowlistedShell))).toBe('text')
  })
})

describe('validateOdvValue modes', () => {
  const stringOdv = odv({ datatype: 'string', recommended: 'x' })
  const sshBanner =
    'You are accessing a U.S. Government (USG) Information System (IS).\n\n-The USG routinely intercepts communications; it is not private.\nSee User Agreement for details.'

  describe('none', () => {
    it('allows an apostrophe, quotes, backslashes and newlines', () => {
      expect(validateOdvValue(stringOdv, "Don't \"quote\" me \\ $(x) ${y} `z`\nnext", 'none', GENERIC_RULE_ID)).toBeNull()
    })
  })

  describe('variable', () => {
    it('allows a multi-line SSH banner with apostrophes and quotes', () => {
      expect(validateOdvValue(stringOdv, sshBanner, 'variable', GENERIC_RULE_ID)).toBeNull()
      expect(validateOdvValue(stringOdv, "Don't \"quote\" $(x)", 'variable', GENERIC_RULE_ID)).toBeNull()
    })
  })

  describe('text', () => {
    it('fails the multi-line SSH banner', () => {
      expect(validateOdvValue(stringOdv, sshBanner, 'text', GENERIC_RULE_ID)).not.toBeNull()
    })

    it('accepts a plain unquoted-safe string', () => {
      expect(validateOdvValue(stringOdv, '30d', 'text', GENERIC_RULE_ID)).toBeNull()
      expect(validateOdvValue(stringOdv, 'time.apple.com', 'text', GENERIC_RULE_ID)).toBeNull()
    })

    it('rejects a string value with shell metacharacters', () => {
      expect(validateOdvValue(stringOdv, '30d; rm -rf /', 'text', GENERIC_RULE_ID)).not.toBeNull()
    })

    it('rejects an apostrophe, which none allows', () => {
      expect(validateOdvValue(stringOdv, "it's", 'text', GENERIC_RULE_ID)).toBe('Value must not contain a single quote.')
      expect(validateOdvValue(stringOdv, "it's", 'none', GENERIC_RULE_ID)).toBeNull()
    })

    it.each([
      ['say "hi"', 'a double quote'],
      ['run `id`', 'a backtick'],
      ['back\\slash', 'a backslash'],
      ['line\nbreak', 'a newline'],
      ['$(reboot)', '"$("'],
      ['${HOME}', '"${"'],
    ])('rejects %j because it contains %s', (value, description) => {
      const regexOdv = odv({ datatype: 'regex', recommended: 'x' })
      expect(validateOdvValue(regexOdv, value, 'text', GENERIC_RULE_ID)).toBe(`Value must not contain ${description}.`)
    })

    it('does not apply the unquoted-string pattern to a regex datatype', () => {
      const regexOdv = odv({ datatype: 'regex', recommended: 'x' })
      expect(validateOdvValue(regexOdv, '^(?=.*[A-Z])(?=.*[a-z]).*$', 'text', GENERIC_RULE_ID)).toBeNull()
    })

    it('applies the denied characters to enum values too', () => {
      const enumOdv = odv({ datatype: 'enum', validation: { enumValues: ["it's"] }, recommended: "it's" })
      expect(validateOdvValue(enumOdv, "it's", 'text', GENERIC_RULE_ID)).toBe('Value must not contain a single quote.')
    })
  })
})

describe('validateOdvValue datatype rules', () => {
  it('accepts an integer within min and max', () => {
    const numberOdv = odv({ validation: { min: 1, max: 10 } })
    expect(validateOdvValue(numberOdv, 5, 'text', GENERIC_RULE_ID)).toBeNull()
    expect(validateOdvValue(numberOdv, 1, 'text', GENERIC_RULE_ID)).toBeNull()
    expect(validateOdvValue(numberOdv, 10, 'text', GENERIC_RULE_ID)).toBeNull()
  })

  it('rejects numbers outside min and max with a reason', () => {
    const numberOdv = odv({ validation: { min: 1, max: 10 } })
    expect(validateOdvValue(numberOdv, 0, 'none', GENERIC_RULE_ID)).toBe('Value must be at least 1.')
    expect(validateOdvValue(numberOdv, 11, 'none', GENERIC_RULE_ID)).toBe('Value must be at most 10.')
  })

  it('rejects non-integer numbers', () => {
    expect(validateOdvValue(odv(), 1.5, 'none', GENERIC_RULE_ID)).toBe('Value must be a whole number.')
    expect(validateOdvValue(odv(), '1e3', 'none', GENERIC_RULE_ID)).toBe('Value must be a whole number.')
  })

  it('rejects integers beyond the safe integer range, which would not survive canonicalisation', () => {
    expect(validateOdvValue(odv(), '9007199254740993', 'none', GENERIC_RULE_ID)).toBe('Value must be a whole number between -9007199254740991 and 9007199254740991.')
    expect(validateOdvValue(odv(), 1e21, 'none', GENERIC_RULE_ID)).toBe('Value must be a whole number.')
    expect(validateOdvValue(odv(), 1e20, 'none', GENERIC_RULE_ID)).toBe('Value must be a whole number between -9007199254740991 and 9007199254740991.')
    expect(validateOdvValue(odv(), Number.MAX_SAFE_INTEGER, 'none', GENERIC_RULE_ID)).toBeNull()
  })

  it('accepts a negative integer and a numeric string for a number datatype', () => {
    expect(validateOdvValue(odv(), -5, 'text', GENERIC_RULE_ID)).toBeNull()
    expect(validateOdvValue(odv(), '42', 'text', GENERIC_RULE_ID)).toBeNull()
  })

  it('requires an enum value to be one of enumValues', () => {
    const enumOdv = odv({ datatype: 'enum', validation: { enumValues: ['a', 'b'] }, recommended: 'a' })
    expect(validateOdvValue(enumOdv, 'a', 'text', GENERIC_RULE_ID)).toBeNull()
    expect(validateOdvValue(enumOdv, 'c', 'text', GENERIC_RULE_ID)).toBe('Value must be one of: a, b.')
  })

  it('applies validation.regex to string values', () => {
    const stringOdv = odv({ datatype: 'string', validation: { regex: '^[a-z]+$' }, recommended: 'abc' })
    expect(validateOdvValue(stringOdv, 'abc', 'text', GENERIC_RULE_ID)).toBeNull()
    expect(validateOdvValue(stringOdv, 'ABC', 'text', GENERIC_RULE_ID)).toBe('Value must match the pattern ^[a-z]+$.')
  })

  it('requires a regex datatype value to compile as a JavaScript RegExp', () => {
    const regexOdv = odv({ datatype: 'regex', recommended: '^a$' })
    expect(validateOdvValue(regexOdv, '^a+$', 'none', GENERIC_RULE_ID)).toBeNull()
    expect(validateOdvValue(regexOdv, '(unclosed', 'none', GENERIC_RULE_ID)).toBe('Value must be a valid regular expression.')
  })

  it.each(['none', 'variable', 'text'] as const)('always rejects a carriage return and NUL in %s', (context) => {
    const stringOdv = odv({ datatype: 'string', recommended: 'x' })
    expect(validateOdvValue(stringOdv, 'a\rb', context, GENERIC_RULE_ID)).toBe('Value must not contain a carriage return.')
    expect(validateOdvValue(stringOdv, 'a\0b', context, GENERIC_RULE_ID)).toBe('Value must not contain a NUL character.')
  })
})

describe('validateOdvValue hardening', () => {
  it.each(['', '   ', '\t'])('rejects the empty or whitespace-only value %j for every datatype', (value) => {
    expect(validateOdvValue(odv(), value, 'none', GENERIC_RULE_ID)).toBe('Value must not be empty.')
    expect(validateOdvValue(odv({ datatype: 'string' }), value, 'none', GENERIC_RULE_ID)).toBe('Value must not be empty.')
    expect(validateOdvValue(odv({ datatype: 'regex' }), value, 'none', GENERIC_RULE_ID)).toBe('Value must not be empty.')
    expect(validateOdvValue(odv({ datatype: 'enum', validation: { enumValues: [' '] } }), value, 'none', GENERIC_RULE_ID)).toBe(
      'Value must not be empty.',
    )
  })

  it('returns a reason instead of throwing when validation.regex does not compile', () => {
    const brokenOdv = odv({ datatype: 'string', validation: { regex: '(unclosed' } })
    expect(validateOdvValue(brokenOdv, 'abc', 'none', GENERIC_RULE_ID)).toBe(
      'This rule defines a validation pattern that is not a valid regular expression.',
    )
  })

  describe('regex datatype in text mode', () => {
    const regexOdv = odv({ datatype: 'regex', recommended: 'x' })

    it.each(['a b', 'a\tb', 'a;b', 'a|b', 'a&b', 'a<b', 'a>b', 'x$HOME', 'x$_y', 'x$ODV'])('rejects %j', (value) => {
      expect(validateOdvValue(regexOdv, value, 'text', GENERIC_RULE_ID)).not.toBeNull()
    })

    it('accepts a lookahead regex ending in a bare dollar', () => {
      expect(validateOdvValue(regexOdv, '^(?=.*[A-Z])(?=.*[a-z]).*$', 'text', GENERIC_RULE_ID)).toBeNull()
    })

    it('does not apply the extra restrictions in none or variable mode', () => {
      expect(validateOdvValue(regexOdv, 'a b;c', 'none', GENERIC_RULE_ID)).toBeNull()
    })
  })
})

describe('validateOdvValue rule-specific value patterns', () => {
  const softwareUpdateRuleId = 'mscp.system_settings_softwareupdate_current'
  const deferralOdv = odv({ datatype: 'string', recommended: '30d' })
  const deferralRequirement = ODV_RULE_VALUE_PATTERNS[softwareUpdateRuleId].requirement

  it.each(['30d', '7d', '2w', '1m', '12H'])('accepts the BSD date -v offset %j', (value) => {
    expect(validateOdvValue(deferralOdv, value, 'text', softwareUpdateRuleId)).toBeNull()
  })

  it.each(['30', 'abc', 'd30', '30 d', '30dd', '-30d'])('rejects %j, which date -v cannot use', (value) => {
    expect(validateOdvValue(deferralOdv, value, 'text', softwareUpdateRuleId)).toBe(deferralRequirement)
  })

  it('names the expected format in the reason', () => {
    expect(validateOdvValue(deferralOdv, '30', 'text', softwareUpdateRuleId)).toBe(
      'Value must be a whole number followed by one unit letter (y, m, w, d, H, M or S), for example 30d.',
    )
  })

  it('applies in every substitution mode', () => {
    expect(validateOdvValue(deferralOdv, '30', 'none', softwareUpdateRuleId)).toBe(deferralRequirement)
    expect(validateOdvValue(deferralOdv, '30', 'variable', softwareUpdateRuleId)).toBe(deferralRequirement)
  })

  it('does not affect other rules', () => {
    expect(validateOdvValue(deferralOdv, '30', 'text', GENERIC_RULE_ID)).toBeNull()
  })

  it('is enforced by prepareOdvValue and usableOdvValue', () => {
    expect(prepareOdvValue(deferralOdv, 'abc', 'text', softwareUpdateRuleId)).toEqual({
      valid: false,
      error: deferralRequirement,
    })
    expect(usableOdvValue(deferralOdv, 'text', '30', softwareUpdateRuleId)).toBe('30d')
  })
})

describe('canonicalOdvValue', () => {
  it('converts a numeric string to a number for a number datatype', () => {
    expect(canonicalOdvValue(odv(), '007')).toBe(7)
    expect(canonicalOdvValue(odv(), '-5')).toBe(-5)
    expect(canonicalOdvValue(odv(), 12)).toBe(12)
  })

  it('leaves an invalid number input unchanged', () => {
    expect(canonicalOdvValue(odv(), '1.5')).toBe('1.5')
  })

  it('leaves non-number datatypes unchanged', () => {
    expect(canonicalOdvValue(odv({ datatype: 'string' }), '007')).toBe('007')
    expect(canonicalOdvValue(odv({ datatype: 'enum' }), '007')).toBe('007')
  })
})

describe('effectiveOdvValue', () => {
  const rule = odv({ recommended: 6 })

  it('prefers the admin value over the recommended value', () => {
    expect(effectiveOdvValue(rule, 12)).toBe(12)
  })

  it('treats an admin value of 0 as set', () => {
    expect(effectiveOdvValue(rule, 0)).toBe(0)
  })

  it('falls back to the recommended value', () => {
    expect(effectiveOdvValue(rule, null)).toBe(6)
  })

  it('is null for a rule without an ODV', () => {
    expect(effectiveOdvValue(null, 5)).toBeNull()
  })
})

describe('substituteOdv and displayWithOdv', () => {
  it('replaces every $ODV', () => {
    expect(substituteOdv('a $ODV b $ODV', 15)).toBe('a 15 b 15')
  })

  it('does not interpret replacement patterns in the value', () => {
    expect(substituteOdv('x $ODV', '$&')).toBe('x $&')
  })

  it('shows a [value] placeholder when there is no value', () => {
    expect(displayWithOdv('At Least $ODV Characters', null)).toBe('At Least [value] Characters')
  })

  it('shows the value when there is one', () => {
    expect(displayWithOdv('At Least $ODV Characters', 15)).toBe('At Least 15 Characters')
  })
})

describe('containsOdvPlaceholder', () => {
  it('detects $ODV in a script or serialized payload', () => {
    expect(containsOdvPlaceholder('{"minLength": "$ODV"}')).toBe(true)
    expect(containsOdvPlaceholder('/usr/bin/true')).toBe(false)
  })
})

describe('odvQuickPicks', () => {
  it('lists Recommended first, then one entry per distinct benchmark value, merging duplicates', () => {
    const picks = odvQuickPicks(
      odv({
        recommended: 6,
        by_benchmark: { cis_lvl1: 15, cis_lvl2: 15, disa_stig: 14, nlmapgov_plus: 6 },
      }),
      vocabularyIndex,
    )

    expect(picks).toEqual([
      { label: 'Recommended', value: 6 },
      { label: 'CIS Level 1, CIS Level 2', value: 15 },
      { label: 'DISA STIG', value: 14 },
      { label: 'NLMAPGOV Plus', value: 6 },
    ])
  })

  it('returns only benchmark entries when there is no recommended value', () => {
    const picks = odvQuickPicks({ ...odv({ by_benchmark: { disa_stig: 3 } }), recommended: undefined as unknown as number }, vocabularyIndex)
    expect(picks).toEqual([{ label: 'DISA STIG', value: 3 }])
  })

  it('names a grouped benchmark once even when several of its codes share a value', () => {
    const grouped = vocabularyIndexOf({ benchmarks: [{ label: 'CIS Level 1', terms: ['cis_lvl1', 'cislevel1'] }] })
    const picks = odvQuickPicks(odv({ recommended: 6, by_benchmark: { cis_lvl1: 15, cislevel1: 15, other_benchmark: 15 } }), grouped)
    expect(picks).toEqual([
      { label: 'Recommended', value: 6 },
      { label: 'CIS Level 1, other_benchmark', value: 15 },
    ])
  })
})

describe('prepareOdvValue', () => {
  it('returns the canonical number for a valid number input', () => {
    expect(prepareOdvValue(odv({ validation: { min: 1 } }), '007', 'text', GENERIC_RULE_ID)).toEqual({ valid: true, value: 7 })
  })

  it('returns the validation reason for an invalid input', () => {
    expect(prepareOdvValue(odv(), "12'", 'text', GENERIC_RULE_ID)).toEqual({ valid: false, error: 'Value must be a whole number.' })
  })

  it('trims trailing newlines in variable mode, since a banner ending in one can never match cat output', () => {
    const banner = odv({ datatype: 'string', recommended: 'x' })
    expect(prepareOdvValue(banner, 'Line one\nLine two\n\n', 'variable', GENERIC_RULE_ID)).toEqual({
      valid: true,
      value: 'Line one\nLine two',
    })
  })

  it('keeps trailing newlines outside variable mode', () => {
    const banner = odv({ datatype: 'string', recommended: 'x' })
    expect(prepareOdvValue(banner, 'Banner\n', 'none', GENERIC_RULE_ID)).toEqual({ valid: true, value: 'Banner\n' })
  })

  it('rejects a value that is only newlines in variable mode', () => {
    const banner = odv({ datatype: 'string', recommended: 'x' })
    expect(prepareOdvValue(banner, '\n\n', 'variable', GENERIC_RULE_ID)).toEqual({ valid: false, error: 'Value must not be empty.' })
  })
})

describe('usableOdvValue', () => {
  const rule = odv({ recommended: 6, validation: { min: 1 } })

  it('uses a valid stored value', () => {
    expect(usableOdvValue(rule, 'text', 12, GENERIC_RULE_ID)).toBe(12)
  })

  it('falls back to the recommended value when the stored value is invalid', () => {
    expect(usableOdvValue(rule, 'text', "12'", GENERIC_RULE_ID)).toBe(6)
    expect(usableOdvValue(rule, 'text', 0, GENERIC_RULE_ID)).toBe(6)
  })

  it('falls back to the recommended value when nothing is stored', () => {
    expect(usableOdvValue(rule, 'text', null, GENERIC_RULE_ID)).toBe(6)
  })

  it('is null for a rule without an ODV', () => {
    expect(usableOdvValue(null, 'none', 12, GENERIC_RULE_ID)).toBeNull()
  })
})
