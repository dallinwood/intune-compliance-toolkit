import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Odv, Rule } from '../types/library'
import {
  canonicalOdvValue,
  codeOdvValues,
  codeTextWithOdvs,
  containsOdvPlaceholder,
  displayWithOdvs,
  effectiveOdvValue,
  hasMalformedOdvPlaceholder,
  odvPlaceholder,
  odvPlaceholderNames,
  odvQuickPicks,
  odvSubstitutionMode,
  ODV_RULE_VALUE_CHECKS,
  ODV_VARIABLE_ALLOWLIST,
  prepareOdvValue,
  substituteOdvs,
  substituteOdvsInJson,
  usableOdvValues,
  validateOdvValue,
} from './odv'
import { ruleWithOdvs } from './testRuleFixtures'
import { committedVocabularyIndex, vocabularyIndexOf } from './testVocabularyFixtures'

const GENERIC_RULE_ID = 'mscp.example_rule'
const vocabularyIndex = committedVocabularyIndex()

function odv(overrides: Partial<Odv> = {}): Odv {
  return {
    name: 'value',
    datatype: 'number',
    description: 'Example',
    validation: null,
    recommended: 6,
    by_benchmark: {},
    quoting: 'unquoted',
    ...overrides,
  }
}

describe('odvSubstitutionMode', () => {
  const allowlistedId = 'mscp.os_policy_banner_ssh_configure'
  const allowlistedShell = ODV_VARIABLE_ALLOWLIST[`${allowlistedId}:value`]
  const valueOdv = odv()

  function ruleWithChecks(id: string, defaultShell: string | null, byVersionShells: Record<string, string> = {}): Rule {
    const checkOf = (shell: string) => ({ shell, result: null, additional_info: null })
    return {
      id,
      odvs: [valueOdv],
      check: {
        macOS: {
          language: 'bash',
          default: defaultShell === null ? null : checkOf(defaultShell),
          by_version: Object.fromEntries(Object.entries(byVersionShells).map(([version, shell]) => [version, checkOf(shell)])),
        },
      },
      discussion: 'Mentions $ODV_value here but that is ignored',
    } as unknown as Rule
  }

  it('is variable for the admin group membership rule with its reviewed shell', () => {
    const adminGroupRuleId = 'mscp.system_settings_admin_group_membership_defined'
    const rule = ruleWithChecks(adminGroupRuleId, ODV_VARIABLE_ALLOWLIST[`${adminGroupRuleId}:value`])
    expect(odvSubstitutionMode(rule, valueOdv)).toBe('variable')
  })

  it('is none when no check shell mentions the placeholder', () => {
    expect(odvSubstitutionMode(ruleWithChecks('mscp.x', '/usr/bin/defaults read com.apple.foo'), valueOdv)).toBe('none')
  })

  it('is none when the rule has no check', () => {
    expect(odvSubstitutionMode({ id: 'mscp.x', check: null } as unknown as Rule, valueOdv)).toBe('none')
    expect(odvSubstitutionMode(ruleWithChecks('mscp.x', null), valueOdv)).toBe('none')
  })

  it('looks only at the placeholder of the ODV asked about, never a longer name it is a prefix of', () => {
    const rule = ruleWithChecks('mscp.x', 'echo $ODV_value_extra')
    expect(odvSubstitutionMode(rule, valueOdv)).toBe('none')
    expect(odvSubstitutionMode(rule, odv({ name: 'value_extra' }))).toBe('text')
  })

  it('is variable for an allowlisted rule whose shell is exactly the reviewed text', () => {
    expect(odvSubstitutionMode(ruleWithChecks(allowlistedId, allowlistedShell), valueOdv)).toBe('variable')
  })

  it('is text for an allowlisted rule whose shell was modified', () => {
    expect(odvSubstitutionMode(ruleWithChecks(allowlistedId, `${allowlistedShell}; id`), valueOdv)).toBe('text')
  })

  it('is text when any by_version shell with the placeholder differs from the reviewed text', () => {
    expect(odvSubstitutionMode(ruleWithChecks(allowlistedId, allowlistedShell, { '26.0': 'echo $ODV_value' }), valueOdv)).toBe('text')
  })

  it('is variable when the same reviewed text is repeated in a by_version shell', () => {
    expect(odvSubstitutionMode(ruleWithChecks(allowlistedId, allowlistedShell, { '26.0': allowlistedShell }), valueOdv)).toBe('variable')
  })

  it('is text for a non-allowlisted rule even if it looks safe', () => {
    expect(odvSubstitutionMode(ruleWithChecks('mscp.other_rule', 'bannerText="$ODV_value"'), valueOdv)).toBe('text')
  })

  it('is text for an allowlisted rule when the ODV asked about has another name', () => {
    expect(odvSubstitutionMode(ruleWithChecks(allowlistedId, allowlistedShell), odv({ name: 'other' }))).toBe('none')
  })

  it('keys the allowlist and the rule value checks by rule id and ODV name', () => {
    expect(Object.keys(ODV_VARIABLE_ALLOWLIST).sort()).toEqual([
      'mscp.os_policy_banner_ssh_configure:value',
      'mscp.system_settings_admin_group_membership_defined:value',
    ])
    expect(Object.keys(ODV_RULE_VALUE_CHECKS).sort()).toEqual([
      'mscp.system_settings_admin_group_membership_defined:value',
      'mscp.system_settings_softwareupdate_current:value',
    ])
    for (const shell of Object.values(ODV_VARIABLE_ALLOWLIST)) expect(shell).toContain('$ODV_value')
  })

  it('ignores the placeholder in a check for a target the generator does not write', () => {
    const rule = ruleWithChecks(allowlistedId, allowlistedShell)
    const windowsCheck = { language: 'powershell', default: { shell: 'Write-Output $ODV_value', result: null, additional_info: null }, by_version: {} }
    const withWindows = { ...rule, check: { ...rule.check, Windows: windowsCheck } } as unknown as Rule
    expect(odvSubstitutionMode(withWindows, valueOdv)).toBe('variable')
    const windowsOnly = { ...rule, check: { Windows: windowsCheck } } as unknown as Rule
    expect(odvSubstitutionMode(windowsOnly, valueOdv)).toBe('none')
  })

  it('is text for a non-allowlisted rule that reuses the allowlisted shell text', () => {
    expect(odvSubstitutionMode(ruleWithChecks('mscp.other_rule', allowlistedShell), valueOdv)).toBe('text')
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

describe('validateOdvValue for the admin group membership rule', () => {
  const adminGroupRuleId = 'mscp.system_settings_admin_group_membership_defined'
  const adminGroupOdv = odv({ datatype: 'regex', recommended: '^(admin)$' })
  const requirement = ODV_RULE_VALUE_CHECKS[`${adminGroupRuleId}:value`].requirement

  // grep -vE "$ODV_value" runs inside found=$(...), so a pattern grep rejects (no
  // output) or one matching every account makes the check pass for the wrong
  // reason.
  it.each(['^(admin)$', '^(admin|jdoe|asmith)$', 'admin|jdoe', '^(adm.n|j\\.doe)$', '^(svc-admin)$', 'admin'])('accepts %j', (value) => {
    expect(validateOdvValue(adminGroupOdv, value, 'variable', adminGroupRuleId)).toBeNull()
  })

  it.each([
    ['a leading hyphen', '-e .'],
    ['a non-capturing group', '(?:admin)'],
    ['a lookahead', '(?=admin)'],
    ['a negative lookahead', '(?!admin)'],
    ['a named group', '(?<name>admin)'],
    ['a digit class', '\\d+'],
    ['a word class', '^\\w+$'],
    ['a space class', 'a\\sb'],
    ['a word boundary', '\\badmin\\b'],
    ['an upper-case class', '\\D'],
    ['an escaped parenthesis', 'a\\(b'],
    ['an empty alternative at the end', 'admin|'],
    ['an empty alternative at the start', '|admin'],
    ['an empty first alternative in a group', '(|admin)'],
    ['an empty last alternative in a group', '(admin|)'],
    ['an empty alternative between two', 'a||b'],
    ['an empty group', '^()$'],
    ['an alternative of only an anchor', '^admin$|^'],
    ['a pattern that is only anchors', '^$'],
    ['curly-brace repetition', 'a{2}'],
    ['a space', 'a b'],
    ['a dot alone', '.'],
    ['a POSIX collating symbol that means any character but one', '[^[.a.]]'],
    ['a POSIX collating symbol', '[[.a.]]'],
    ['a collating symbol for a hyphen', '[[.-.]]'],
    ['a plain bracket class', '[a-z]'],
    ['a bracket class in a group', '^([a-z]|admin)$'],
    ['dots with no anchors, which match every long name', '...'],
    ['any text', '.*'],
    ['any text between anchors', '^.*$'],
    ['an optional dot', '.?'],
    ['a starred letter', 'a*'],
    ['an optional group', '(admin)?'],
    ['a starred group', '^(admin)*$'],
    ['a starred alternation', '(a|b)*'],
    ['a starred class', '[a-z]*'],
    ['a starred negated class', '[^x]*'],
    ['a lazy star', 'a*?'],
    ['a lazy plus', 'a+?'],
    ['a doubled question mark', 'a??'],
    ['a bracket closing straight away', '[]a]'],
    ['a negated bracket closing straight away', '[^]a]'],
  ])('rejects %s (%j) with the requirement text', (_description, value) => {
    expect(validateOdvValue(adminGroupOdv, value, 'variable', adminGroupRuleId)).toBe(requirement)
  })

  it.each(['^(admin$', '^admin)$', '^[abc$', '*admin', 'a|*b'])('rejects %j, which is not a regular expression at all', (value) => {
    expect(validateOdvValue(adminGroupOdv, value, 'variable', adminGroupRuleId)).toBe('Value must be a valid regular expression.')
  })

  it('explains the limits in plain words', () => {
    expect(requirement).toBe(
      'Use account names separated by |, optionally wrapped as ^(...)$, for example ^(admin|jdoe)$. A dot matches any one character. Brackets, repetition symbols such as * and ?, and other backslash escapes are not allowed, so the check can never silently pass.',
    )
  })
})

describe('validateOdvValue rule-specific value patterns', () => {
  const softwareUpdateRuleId = 'mscp.system_settings_softwareupdate_current'
  const deferralOdv = odv({ datatype: 'string', recommended: '30d' })
  const deferralRequirement = ODV_RULE_VALUE_CHECKS[`${softwareUpdateRuleId}:value`].requirement

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

  it('is enforced by prepareOdvValue and usableOdvValues', () => {
    expect(prepareOdvValue(deferralOdv, 'abc', 'text', softwareUpdateRuleId)).toEqual({
      valid: false,
      error: deferralRequirement,
    })
    const rule = ruleWithOdvs([deferralOdv], { id: softwareUpdateRuleId })
    expect(usableOdvValues(rule, { value: '30' })).toEqual({ value: '30d' })
  })

  it('applies only to the ODV named in its key', () => {
    expect(validateOdvValue(odv({ ...deferralOdv, name: 'other' }), '30', 'text', softwareUpdateRuleId)).toBeNull()
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

describe('odvPlaceholder', () => {
  it('derives the placeholder from the name', () => {
    expect(odvPlaceholder('value')).toBe('$ODV_value')
  })
})

describe('substituteOdvs and displayWithOdvs', () => {
  it('replaces every placeholder with its own value', () => {
    expect(substituteOdvs('a $ODV_x b $ODV_y c $ODV_x', { x: 15, y: 'q' })).toBe('a 15 b q c 15')
  })

  it('never matches a placeholder inside a longer name that starts with it', () => {
    expect(substituteOdvs('$ODV_a and $ODV_a_b and $ODV_ab', { a: 1, a_b: 2, ab: 3 })).toBe('1 and 2 and 3')
    expect(substituteOdvs('$ODV_a_b', { a: 1 })).toBe('$ODV_a_b')
  })

  it('leaves a name without a value as it is, or uses the given stand-in', () => {
    expect(substituteOdvs('$ODV_a $ODV_b', { a: 1 })).toBe('1 $ODV_b')
    expect(substituteOdvs('$ODV_a $ODV_b', { a: 1 }, '?')).toBe('1 ?')
  })

  it('does not read a name from the value object prototype', () => {
    expect(substituteOdvs('$ODV_constructor', {})).toBe('$ODV_constructor')
  })

  it('does not interpret replacement patterns in the value, or replace again inside it', () => {
    expect(substituteOdvs('x $ODV_a', { a: '$&' })).toBe('x $&')
    expect(substituteOdvs('$ODV_a $ODV_b', { a: '$ODV_b', b: 2 })).toBe('$ODV_b 2')
  })

  it('shows a [value] placeholder for a name with no value', () => {
    expect(displayWithOdvs('At Least $ODV_value Characters', {})).toBe('At Least [value] Characters')
  })

  it('shows the value when there is one', () => {
    expect(displayWithOdvs('At Least $ODV_value Characters', { value: 15 })).toBe('At Least 15 Characters')
  })
})

interface GrammarCase {
  name: string
  text: string
  names: string[]
  malformed: string[]
  display: string
}

const GRAMMAR_CASES = (
  JSON.parse(
    readFileSync(new URL('../../../tests/fixtures/odv_placeholders/grammar_cases.json', import.meta.url), 'utf8'),
  ) as { grammar_cases: GrammarCase[] }
).grammar_cases

describe('shared placeholder grammar cases', () => {
  it.each(GRAMMAR_CASES.map((grammarCase) => [grammarCase.name, grammarCase] as const))('%s', (_name, grammarCase) => {
    expect(odvPlaceholderNames(grammarCase.text)).toEqual(grammarCase.names)
    expect(displayWithOdvs(grammarCase.text, {})).toBe(grammarCase.display)
    expect(hasMalformedOdvPlaceholder(grammarCase.text)).toBe(grammarCase.malformed.length > 0)
  })

  it('never substitutes into a malformed occurrence, even when the name before it has a value', () => {
    expect(substituteOdvs('echo $ODV_vX $ODV_v', { v: 'value' })).toBe('echo $ODV_vX value')
  })
})

describe('containsOdvPlaceholder', () => {
  it('detects a placeholder in a script or serialized payload', () => {
    expect(containsOdvPlaceholder('{"minLength": "$ODV_value"}')).toBe(true)
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

describe('usableOdvValues', () => {
  const lengthOdv = odv({ name: 'length', recommended: 6, validation: { min: 1 } })
  const labelOdv = odv({ name: 'label', datatype: 'string', recommended: 'ab' })
  const rule = ruleWithOdvs([lengthOdv, labelOdv])

  it('uses a valid stored value and the recommended value for a name not stored', () => {
    expect(usableOdvValues(rule, { length: 12 })).toEqual({ length: 12, label: 'ab' })
  })

  it('falls back to the recommended value when a stored value is invalid', () => {
    expect(usableOdvValues(rule, { length: "12'" })).toEqual({ length: 6, label: 'ab' })
    expect(usableOdvValues(rule, { length: 0 })).toEqual({ length: 6, label: 'ab' })
  })

  it('ignores a stored name the rule does not define', () => {
    expect(usableOdvValues(rule, { other: 1 })).toEqual({ length: 6, label: 'ab' })
  })

  it('is empty for a rule without ODVs', () => {
    expect(usableOdvValues(ruleWithOdvs([]), { value: 12 })).toEqual({})
  })
})

describe('codeOdvValues', () => {
  const numberOdv = odv({ recommended: 6, validation: { min: 1 } })
  const stringOdv = odv({ datatype: 'string', recommended: 'ab' })
  const injection = 'a"; rm -rf ~ #'
  const none = { verifiedShell: {}, strict: {}, json: {}, exported: {} }
  const ruleOf = (odvValue: Odv, overrides: Partial<Rule> = {}) => ruleWithOdvs([odvValue], overrides)
  const textModeCheck = {
    macOS: { language: 'bash', default: { shell: 'echo $ODV_value', result: null, additional_info: null }, by_version: {} },
  } as const

  it('returns a valid value for scripts and JSON so code blocks show it in place of the placeholder', () => {
    expect(codeOdvValues(ruleOf(numberOdv), { value: 12 })).toEqual({ verifiedShell: { value: 12 }, strict: { value: 12 }, json: { value: 12 }, exported: {} })
    expect(substituteOdvs('minlen=$ODV_value and again $ODV_value', { value: 12 })).toBe('minlen=12 and again 12')
  })

  it('returns nothing when there is no value or the rule has no ODV, keeping the placeholder literal', () => {
    expect(codeOdvValues(ruleOf(numberOdv), {})).toEqual(none)
    expect(codeOdvValues(ruleWithOdvs([]), { value: 12 })).toEqual(none)
  })

  it('returns nothing for a value the generator would reject', () => {
    expect(codeOdvValues(ruleOf(numberOdv), { value: 0 })).toEqual(none)
    expect(codeOdvValues(ruleOf(numberOdv), { value: "12'" })).toEqual(none)
    expect(codeOdvValues(ruleOf(stringOdv, { check: textModeCheck }), { value: 'a b' })).toEqual(none)
  })

  it('applies the rule-specific value pattern', () => {
    const deferralOdv = odv({ datatype: 'string', recommended: '30d' })
    const softwareUpdateRule = ruleOf(deferralOdv, { id: 'mscp.system_settings_softwareupdate_current' })
    expect(codeOdvValues(softwareUpdateRule, { value: '30d' }).strict).toEqual({ value: '30d' })
    expect(codeOdvValues(softwareUpdateRule, { value: '30' })).toEqual(none)
  })

  it('returns the canonical value the generator would substitute', () => {
    expect(codeOdvValues(ruleOf(numberOdv), { value: '007' }).strict).toEqual({ value: 7 })
  })

  it('never text-replaces in variable mode, offering the generator-validated value as the exported one', () => {
    const bannerOdv = odv({ datatype: 'string', recommended: 'Authorized use only' })
    const bannerRuleId = 'mscp.os_policy_banner_ssh_configure'
    const bannerRule = ruleWithOdvs([bannerOdv], {
      id: bannerRuleId,
      check: {
        macOS: {
          language: 'bash',
          default: { shell: ODV_VARIABLE_ALLOWLIST[`${bannerRuleId}:value`], result: null, additional_info: null },
          by_version: {},
        },
      },
    })
    const value = "it's \"$HOME\" `x` \\ ok"
    expect(codeOdvValues(bannerRule, { value })).toEqual({ verifiedShell: {}, strict: {}, json: {}, exported: { value } })
    expect(codeOdvValues(bannerRule, { value: 'bad' + String.fromCharCode(13) + 'value' })).toEqual(none)
    expect(codeOdvValues(bannerRule, {})).toEqual(none)
  })

  it('applies the strict shell-safe rules to unquoted scripts even when the generator never substitutes (none mode)', () => {
    expect(codeOdvValues(ruleOf(stringOdv), { value: injection }).strict).toEqual({})
    for (const unsafe of ["it's", 'a`b`', 'a$(id)', 'a${HOME}', 'a\\b', 'a\nb', 'two words', '/etc/x.conf']) {
      expect(codeOdvValues(ruleOf(stringOdv), { value: unsafe }).strict).toEqual({})
    }
    expect(codeOdvValues(ruleOf(stringOdv), { value: 'safe-value_1.2' }).strict).toEqual({ value: 'safe-value_1.2' })
  })

  it('applies the strict rules to a numeric none-mode rule', () => {
    expect(codeOdvValues(ruleOf(numberOdv), { value: 12 }).strict).toEqual({ value: 12 })
    expect(codeOdvValues(ruleOf(numberOdv), { value: '12; id' })).toEqual(none)
  })

  it('shows the same value as the generator for a text-mode rule', () => {
    const textRule = ruleOf(stringOdv, { check: textModeCheck })
    expect(codeOdvValues(textRule, { value: 'safe-value' }).strict).toEqual({ value: 'safe-value' })
    expect(codeOdvValues(textRule, { value: injection }).strict).toEqual({})
  })

  it('lets JSON show a value that is only unsafe as shell text, still requiring the ODV own validation', () => {
    expect(codeOdvValues(ruleOf(stringOdv), { value: 'two words' })).toEqual({ verifiedShell: {}, strict: {}, json: { value: 'two words' }, exported: {} })
    expect(codeOdvValues(ruleOf(numberOdv), { value: 0 })).toEqual(none)
  })

  describe('by quoting', () => {
    const singleOdv = odv({ datatype: 'string', quoting: 'single' })
    const doubleOdv = odv({ datatype: 'string', quoting: 'double' })

    it('shows a path for a single-quoted ODV but not for an unquoted one', () => {
      expect(codeOdvValues(ruleOf(singleOdv), { value: '/etc/x.conf' }).verifiedShell).toEqual({ value: '/etc/x.conf' })
      expect(codeOdvValues(ruleOf(stringOdv), { value: '/etc/x.conf' }).verifiedShell).toEqual({})
    })

    it('hides what ends single quotes, and a newline, carriage return or NUL', () => {
      for (const unsafe of ["it's", 'a\nb', 'a\rb', 'a\0b']) {
        expect(codeOdvValues(ruleOf(singleOdv), { value: unsafe }).verifiedShell).toEqual({})
      }
      expect(codeOdvValues(ruleOf(singleOdv), { value: 'say "hi" $HOME `x` \\' }).verifiedShell).toEqual({ value: 'say "hi" $HOME `x` \\' })
    })

    it('hides what ends or expands inside double quotes', () => {
      for (const unsafe of ['say "hi"', 'a`b`', '$HOME', 'a\\b', 'a\nb', 'a\rb', 'a\0b']) {
        expect(codeOdvValues(ruleOf(doubleOdv), { value: unsafe }).verifiedShell).toEqual({})
      }
      expect(codeOdvValues(ruleOf(doubleOdv), { value: "it's a path /etc/x.conf" }).verifiedShell).toEqual({ value: "it's a path /etc/x.conf" })
    })

    it('still applies the datatype and the ODV own validation', () => {
      const quotedNumber = odv({ quoting: 'single', validation: { min: 1 } })
      expect(codeOdvValues(ruleOf(quotedNumber), { value: 0 }).verifiedShell).toEqual({})
      expect(codeOdvValues(ruleOf(quotedNumber), { value: 3 }).verifiedShell).toEqual({ value: 3 })
    })

    it('hides the typographic quotes PowerShell reads as quotes', () => {
      for (const typographicQuote of ['\u2018', '\u2019', '\u201a', '\u201b']) {
        expect(codeOdvValues(ruleOf(singleOdv), { value: `x${typographicQuote}; Write-Output INJECTED` }).verifiedShell).toEqual({})
      }
      for (const typographicQuote of ['\u201c', '\u201d', '\u201e']) {
        expect(codeOdvValues(ruleOf(doubleOdv), { value: `x${typographicQuote}; Write-Output INJECTED` }).verifiedShell).toEqual({})
      }
    })

    it('uses the strict rules outside verified shells, whatever the quoting', () => {
      expect(codeOdvValues(ruleOf(singleOdv), { value: '/etc/x.conf' }).strict).toEqual({})
      expect(codeOdvValues(ruleOf(doubleOdv), { value: 'a; id' }).strict).toEqual({})
      expect(codeOdvValues(ruleOf(singleOdv), { value: 'safe-value' }).strict).toEqual({ value: 'safe-value' })
    })

    it('does not change the JSON gate', () => {
      expect(codeOdvValues(ruleOf(singleOdv), { value: "it's" }).json).toEqual({ value: "it's" })
    })
  })

  it('treats every ODV of a rule on its own', () => {
    const lengthOdv = odv({ name: 'length' })
    const pathOdv = odv({ name: 'path', datatype: 'string', quoting: 'single' })
    const rule = ruleWithOdvs([lengthOdv, pathOdv])
    expect(codeOdvValues(rule, { length: 12, path: '/etc/x' }).verifiedShell).toEqual({ length: 12, path: '/etc/x' })
    expect(codeOdvValues(rule, { length: '1;2', path: '/etc/x' }).verifiedShell).toEqual({ path: '/etc/x' })
  })
})

describe('codeTextWithOdvs', () => {
  it('is the displayed and copied text: substituted when a value applies, untouched otherwise', () => {
    expect(codeTextWithOdvs('a $ODV_value b', { value: 12 }, false)).toBe('a 12 b')
    expect(codeTextWithOdvs('a $ODV_value b', {}, false)).toBe('a $ODV_value b')
    expect(codeTextWithOdvs('{"v": "$ODV_value"}', { value: 'x"y' }, true)).toBe('{"v": "x\\"y"}')
  })
})

describe('substituting special characters into displayed code', () => {
  it('substitutes regex-special characters and replacement patterns literally', () => {
    expect(substituteOdvs('grep -E "$ODV_value"', { value: '^a.*$&b$1' })).toBe('grep -E "^a.*$&b$1"')
  })

  it('escapes the value inside displayed JSON so the document stays valid', () => {
    const json = JSON.stringify({ banner: '$ODV_value', other: ['$ODV_value'] }, null, 2)
    const displayed = substituteOdvsInJson(json, { value: 'say "hi"\n' })
    expect(JSON.parse(displayed)).toEqual({ banner: 'say "hi"\n', other: ['say "hi"\n'] })
  })
})
