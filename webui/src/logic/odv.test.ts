import { describe, expect, it } from 'vitest'
import type { Odv, Rule } from '../types/library'
import { canonicalOdvValue, displayWithOdv,effectiveOdvValue, odvQuickPicks, odvShellContext, substituteOdv, validateOdvValue } from './odv'

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

describe('odvShellContext', () => {
  function ruleWithChecks(defaultShell: string | null, byVersionShells: Record<string, string> = {}): Rule {
    const checkOf = (shell: string) => ({ shell, result: null, additional_info: null })
    return {
      check: {
        default: defaultShell === null ? null : checkOf(defaultShell),
        by_version: Object.fromEntries(Object.entries(byVersionShells).map(([version, shell]) => [version, checkOf(shell)])),
      },
      discussion: 'Mentions $ODV here but that is ignored',
    } as unknown as Rule
  }

  it('is none when no check shell mentions $ODV', () => {
    expect(odvShellContext(ruleWithChecks('/usr/bin/defaults read com.apple.foo'))).toBe('none')
  })

  it('is none when the rule has no check', () => {
    expect(odvShellContext({ check: null } as unknown as Rule)).toBe('none')
    expect(odvShellContext(ruleWithChecks(null))).toBe('none')
  })

  it('is double_quoted when every occurrence is exactly "$ODV"', () => {
    const shell = 'banner="$ODV"; test "$(cat /etc/banner)" = "$ODV"'
    expect(odvShellContext(ruleWithChecks(shell))).toBe('double_quoted')
  })

  it('is other when an occurrence is unquoted', () => {
    expect(odvShellContext(ruleWithChecks('date -v -$ODV +%s'))).toBe('other')
  })

  it('is other when only some occurrences are double quoted', () => {
    expect(odvShellContext(ruleWithChecks('a="$ODV"; b=$ODV'))).toBe('other')
  })

  it('is double_quoted when the placeholder is embedded in a larger double-quoted string', () => {
    expect(odvShellContext(ruleWithChecks('echo "value=$ODV"'))).toBe('double_quoted')
  })

  it('considers by_version shells too', () => {
    expect(odvShellContext(ruleWithChecks('echo "$ODV"', { '26.0': 'echo $ODV' }))).toBe('other')
    expect(odvShellContext(ruleWithChecks(null, { '26.0': 'echo "$ODV"' }))).toBe('double_quoted')
  })
})

describe('validateOdvValue datatype rules', () => {
  it('accepts an integer within min and max', () => {
    const numberOdv = odv({ validation: { min: 1, max: 10 } })
    expect(validateOdvValue(numberOdv, 5, 'other')).toBeNull()
    expect(validateOdvValue(numberOdv, 1, 'other')).toBeNull()
    expect(validateOdvValue(numberOdv, 10, 'other')).toBeNull()
  })

  it('rejects numbers outside min and max with a reason', () => {
    const numberOdv = odv({ validation: { min: 1, max: 10 } })
    expect(validateOdvValue(numberOdv, 0, 'none')).toBe('Value must be at least 1.')
    expect(validateOdvValue(numberOdv, 11, 'none')).toBe('Value must be at most 10.')
  })

  it('rejects non-integer numbers', () => {
    expect(validateOdvValue(odv(), 1.5, 'none')).toBe('Value must be a whole number.')
    expect(validateOdvValue(odv(), '1e3', 'none')).toBe('Value must be a whole number.')
  })

  it('accepts a negative integer and a numeric string for a number datatype', () => {
    expect(validateOdvValue(odv(), -5, 'other')).toBeNull()
    expect(validateOdvValue(odv(), '42', 'other')).toBeNull()
  })

  it('requires an enum value to be one of enumValues', () => {
    const enumOdv = odv({ datatype: 'enum', validation: { enumValues: ['a', 'b'] }, recommended: 'a' })
    expect(validateOdvValue(enumOdv, 'a', 'other')).toBeNull()
    expect(validateOdvValue(enumOdv, 'c', 'other')).toBe('Value must be one of: a, b.')
  })

  it('applies validation.regex to string values', () => {
    const stringOdv = odv({ datatype: 'string', validation: { regex: '^[a-z]+$' }, recommended: 'abc' })
    expect(validateOdvValue(stringOdv, 'abc', 'other')).toBeNull()
    expect(validateOdvValue(stringOdv, 'ABC', 'other')).toBe('Value must match the pattern ^[a-z]+$.')
  })

  it('requires a regex datatype value to compile as a JavaScript RegExp', () => {
    const regexOdv = odv({ datatype: 'regex', recommended: '^a$' })
    expect(validateOdvValue(regexOdv, '^a+$', 'none')).toBeNull()
    expect(validateOdvValue(regexOdv, '(unclosed', 'none')).toBe('Value must be a valid regular expression.')
  })

  it.each(['none', 'double_quoted', 'other'] as const)('always rejects a carriage return and NUL in %s', (context) => {
    const stringOdv = odv({ datatype: 'string', recommended: 'x' })
    expect(validateOdvValue(stringOdv, 'a\rb', context)).toBe('Value must not contain a carriage return.')
    expect(validateOdvValue(stringOdv, 'a\0b', context)).toBe('Value must not contain a NUL character.')
  })
})

describe('validateOdvValue shell context rules', () => {
  const stringOdv = odv({ datatype: 'string', recommended: 'x' })
  const sshBanner =
    'You are accessing a U.S. Government (USG) Information System (IS).\n\n-The USG routinely intercepts communications; it is not private.\nSee User Agreement for details.'

  describe('none', () => {
    it('allows an apostrophe, quotes, backslashes and newlines', () => {
      expect(validateOdvValue(stringOdv, "Don't \"quote\" me \\ $(x) ${y} `z`\nnext", 'none')).toBeNull()
    })
  })

  describe('double_quoted', () => {
    it('allows an SSH banner with newlines and apostrophes', () => {
      expect(validateOdvValue(stringOdv, sshBanner, 'double_quoted')).toBeNull()
      expect(validateOdvValue(stringOdv, "Don't", 'double_quoted')).toBeNull()
    })

    it.each([
      ['say "hi"', 'a double quote'],
      ['cost $5', 'a dollar sign'],
      ['run `id`', 'a backtick'],
      ['back\\slash', 'a backslash'],
      ['$(reboot)', 'a dollar sign'],
    ])('rejects %j because it contains %s', (value, description) => {
      expect(validateOdvValue(stringOdv, value, 'double_quoted')).toBe(`Value must not contain ${description}.`)
    })
  })

  describe('other', () => {
    it('accepts a plain unquoted-safe string', () => {
      expect(validateOdvValue(stringOdv, '30d', 'other')).toBeNull()
      expect(validateOdvValue(stringOdv, 'time.apple.com', 'other')).toBeNull()
    })

    it('rejects a string value with shell metacharacters', () => {
      expect(validateOdvValue(stringOdv, '30d; rm -rf /', 'other')).not.toBeNull()
    })

    it('rejects an apostrophe, which none allows', () => {
      expect(validateOdvValue(stringOdv, "it's", 'other')).toBe('Value must not contain a single quote.')
      expect(validateOdvValue(stringOdv, "it's", 'none')).toBeNull()
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
      expect(validateOdvValue(regexOdv, value, 'other')).toBe(`Value must not contain ${description}.`)
    })

    it('does not apply the unquoted-string pattern to a regex datatype', () => {
      const regexOdv = odv({ datatype: 'regex', recommended: 'x' })
      expect(validateOdvValue(regexOdv, '^(?=.*[A-Z])(?=.*[a-z]).*$', 'other')).toBeNull()
    })

    it('applies the denied characters to enum values too', () => {
      const enumOdv = odv({ datatype: 'enum', validation: { enumValues: ["it's"] }, recommended: "it's" })
      expect(validateOdvValue(enumOdv, "it's", 'other')).toBe('Value must not contain a single quote.')
    })
  })
})

describe('odvShellContext quote tracking', () => {
  function ruleWithShell(shell: string | null): Rule {
    return { check: { default: { shell, result: null, additional_info: null }, by_version: {} } } as unknown as Rule
  }

  it.each([
    ['x=""$ODV""', 'other'],
    ["x='\"$ODV\"'", 'other'],
    ['awk \'{ if ($2 == "$ODV") print }\'', 'other'],
    ['cat <<EOF\n"$ODV"\nEOF', 'other'],
    ['bannerText="$ODV"', 'double_quoted'],
    ['[[ "${SS_RULE}" == "$ODV" ]]', 'double_quoted'],
    ['x="a \\" b $ODV"', 'double_quoted'],
    ['x=\\"$ODV"', 'other'],
    ['x="a" y=$ODV', 'other'],
  ])('classifies %j as %s', (shell, expectedContext) => {
    expect(odvShellContext(ruleWithShell(shell))).toBe(expectedContext)
  })

  it('treats a heredoc in any check shell as other even when the placeholder is double quoted', () => {
    const rule = {
      check: {
        default: { shell: 'echo "$ODV"', result: null, additional_info: null },
        by_version: { '26.0': { shell: 'cat <<EOF\nEOF', result: null, additional_info: null } },
      },
    } as unknown as Rule
    expect(odvShellContext(rule)).toBe('other')
  })

  it('handles a null check shell', () => {
    expect(odvShellContext(ruleWithShell(null))).toBe('none')
  })
})

describe('validateOdvValue hardening', () => {
  it.each(['', '   ', '\t'])('rejects the empty or whitespace-only value %j for every datatype', (value) => {
    expect(validateOdvValue(odv(), value, 'none')).toBe('Value must not be empty.')
    expect(validateOdvValue(odv({ datatype: 'string' }), value, 'none')).toBe('Value must not be empty.')
    expect(validateOdvValue(odv({ datatype: 'regex' }), value, 'none')).toBe('Value must not be empty.')
    expect(validateOdvValue(odv({ datatype: 'enum', validation: { enumValues: [' '] } }), value, 'none')).toBe(
      'Value must not be empty.',
    )
  })

  it('returns a reason instead of throwing when validation.regex does not compile', () => {
    const brokenOdv = odv({ datatype: 'string', validation: { regex: '(unclosed' } })
    expect(validateOdvValue(brokenOdv, 'abc', 'none')).toBe(
      'This rule defines a validation pattern that is not a valid regular expression.',
    )
  })

  describe('regex datatype in other context', () => {
    const regexOdv = odv({ datatype: 'regex', recommended: 'x' })

    it.each(['a b', 'a\tb', 'a;b', 'a|b', 'a&b', 'a<b', 'a>b', 'x$HOME', 'x$_y', 'x$ODV'])('rejects %j', (value) => {
      expect(validateOdvValue(regexOdv, value, 'other')).not.toBeNull()
    })

    it('accepts a lookahead regex ending in a bare dollar', () => {
      expect(validateOdvValue(regexOdv, '^(?=.*[A-Z])(?=.*[a-z]).*$', 'other')).toBeNull()
    })

    it('does not apply the extra restrictions in none or double_quoted context', () => {
      expect(validateOdvValue(regexOdv, 'a b;c', 'none')).toBeNull()
    })
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

describe('odvQuickPicks', () => {
  it('lists Recommended first, then one entry per distinct benchmark value, merging duplicates', () => {
    const picks = odvQuickPicks(
      odv({
        recommended: 6,
        by_benchmark: { cis_lvl1: 15, cis_lvl2: 15, disa_stig: 14, nlmapgov_plus: 6 },
      }),
    )

    expect(picks).toEqual([
      { label: 'Recommended', value: 6 },
      { label: 'CIS Level 1, CIS Level 2', value: 15 },
      { label: 'DISA STIG', value: 14 },
      { label: 'NLMAPGOV Plus', value: 6 },
    ])
  })

  it('returns only benchmark entries when there is no recommended value', () => {
    const picks = odvQuickPicks({ ...odv({ by_benchmark: { disa_stig: 3 } }), recommended: undefined as unknown as number })
    expect(picks).toEqual([{ label: 'DISA STIG', value: 3 }])
  })
})
