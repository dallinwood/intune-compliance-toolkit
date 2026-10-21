import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RuleCheckPlan } from '../checkPlan'
import { generateBashScript } from './bash'

interface RunOptions {
  osMajor: string
  arch?: string
}

// Executes the generated script through real bash, with zsh replaced by bash
// for the checks themselves (zsh is not available on the Windows dev machine).
function runScript(script: string, { osMajor, arch = 'arm64' }: RunOptions): Record<string, unknown> {
  const directory = mkdtempSync(join(tmpdir(), 'bash-scriptgen-'))
  const scriptPath = join(directory, 'discovery.sh')
  writeFileSync(scriptPath, script, { encoding: 'utf-8' })

  execFileSync('bash', ['-n', scriptPath])
  const stdout = execFileSync('bash', [scriptPath], {
    encoding: 'utf-8',
    env: { ...process.env, ICT_TEST_OS_MAJOR: osMajor, ICT_TEST_ARCH: arch, ICT_TEST_CHECK_SHELL: 'bash' },
  })
  const lines = stdout.split('\n').filter((line) => line !== '')
  expect(lines).toHaveLength(1)
  return JSON.parse(lines[0]) as Record<string, unknown>
}

function rawStringPlan(overrides: Partial<RuleCheckPlan> = {}): RuleCheckPlan {
  const settingName = overrides.settingName ?? 'raw_rule'
  return {
    id: `mscp.${settingName}`,
    title: 'Raw rule',
    settingName,
    architecture: null,
    reporting: 'raw',
    dataType: 'String',
    operand: 'PASS',
    branches: [{ majors: ['15', '26'], shell: 'echo LISTED', expected: { type: 'string', value: 'PASS' } }],
    newerThan: '27',
    newerBranch: { shell: 'echo NEWER', expected: { type: 'string', value: 'PASS' } },
    odvValue: null,
    exportedOdv: null,
    ...overrides,
  }
}

function booleanPlan(overrides: Partial<RuleCheckPlan> = {}): RuleCheckPlan {
  return rawStringPlan({
    settingName: 'boolean_rule',
    reporting: 'boolean',
    dataType: 'Boolean',
    operand: true,
    branches: [
      { majors: ['15'], shell: 'echo 1', expected: { type: 'integer', value: 1 } },
      { majors: ['26'], shell: 'echo FAIL', expected: { type: 'string', value: 'PASS' } },
    ],
    newerBranch: { shell: "echo \"it's\"", expected: { type: 'string', value: "it's" } },
    ...overrides,
  })
}

describe('generateBashScript structure', () => {
  it('starts with a bash shebang, attributes mSCP and always exits 0', () => {
    const script = generateBashScript([rawStringPlan()])

    expect(script.startsWith('#!/bin/bash\n')).toBe(true)
    expect(script).toContain('https://github.com/usnistgov/macos_security')
    expect(script).toContain('https://creativecommons.org/licenses/by/4.0/')
    expect(script.trimEnd().endsWith('exit 0')).toBe(true)
  })

  it('copies the mSCP preamble variables and exports them for the checks', () => {
    const script = generateBashScript([rawStringPlan()])

    expect(script).toContain('plb="/usr/libexec/PlistBuddy"')
    expect(script).toContain('CURRENT_USER=$( /usr/bin/defaults read /Library/Preferences/com.apple.loginwindow lastUserName 2>/dev/null )')
    expect(script).toContain('CURR_USER_UID=$(/usr/bin/id -u $CURRENT_USER)')
    expect(script).toContain('CURR_HOSTNAME=$(/usr/sbin/scutil --get HostName 2>/dev/null)')
    expect(script).toContain('arch=${ICT_TEST_ARCH:-$(/usr/bin/arch)}')
    expect(script).toContain('export plb CURRENT_USER CURR_USER_UID CURR_HOSTNAME arch')
    expect(script).toContain('__os_major=${ICT_TEST_OS_MAJOR:-$(/usr/bin/sw_vers -productVersion 2>/dev/null | /usr/bin/cut -d. -f1)}')
  })

  it('runs every check through zsh unless the test override is set', () => {
    const script = generateBashScript([rawStringPlan()])

    expect(script).toContain('/bin/zsh --no-rcs -c "$1"')
    expect(script).toContain("__result_raw_rule=$( __run_check 'echo LISTED\n' )")
  })

  it('throws when a shell or expected value still contains $ODV', () => {
    expect(() => generateBashScript([rawStringPlan({ branches: [{ majors: ['15'], shell: 'echo $ODV', expected: { type: 'string', value: 'PASS' } }] })])).toThrow(/\$ODV/)
    expect(() => generateBashScript([rawStringPlan({ newerBranch: { shell: 'echo $ODV', expected: { type: 'string', value: 'PASS' } } })])).toThrow(/\$ODV/)
    expect(() => generateBashScript([rawStringPlan({ branches: [{ majors: ['15'], shell: 'echo x', expected: { type: 'string', value: '$ODV' } }] })])).toThrow(/\$ODV/)
  })

  it('allows $ODV in the shell of a plan that exports the ODV as a variable', () => {
    const plan = rawStringPlan({ branches: [{ majors: ['15'], shell: 'echo "$ODV"', expected: { type: 'string', value: 'PASS' } }], exportedOdv: 'x' })

    expect(() => generateBashScript([plan])).not.toThrow()
  })

  it('keeps a title with a newline on its comment line', () => {
    const script = generateBashScript([rawStringPlan({ title: 'First\nreboot' })])

    expect(script).toContain('# --- mscp.raw_rule: First reboot ---\n')
  })

  it('throws on duplicate SettingNames', () => {
    expect(() => generateBashScript([rawStringPlan(), rawStringPlan()])).toThrow(/raw_rule/)
  })
})

describe('generateBashScript executed through bash', () => {
  const script = generateBashScript([rawStringPlan(), booleanPlan()])

  it('runs the listed branch on a listed major', () => {
    expect(runScript(script, { osMajor: '15' })).toEqual({ raw_rule: 'LISTED', boolean_rule: true })
    expect(runScript(script, { osMajor: '26' })).toEqual({ raw_rule: 'LISTED', boolean_rule: false })
  })

  it('passes on a covered major the rule does not list', () => {
    expect(runScript(script, { osMajor: '27' })).toEqual({ raw_rule: 'PASS', boolean_rule: true })
  })

  it('runs the newer branch on a major newer than every covered one, comparing single-quoted expected values', () => {
    expect(runScript(script, { osMajor: '28' })).toEqual({ raw_rule: 'NEWER', boolean_rule: true })
  })

  it('passes on a major older than every covered one', () => {
    expect(runScript(script, { osMajor: '14' })).toEqual({ raw_rule: 'PASS', boolean_rule: true })
  })

  it.each(['', 'abc', '15.1'])('reports null for every rule when the OS major %j is not a whole number', (osMajor) => {
    const failClosedScript = generateBashScript([
      rawStringPlan(),
      booleanPlan(),
      rawStringPlan({ settingName: 'integer_rule', dataType: 'Int64', operand: 25, newerBranch: null }),
      rawStringPlan({ settingName: 'arm_rule', architecture: 'arm64' }),
    ])
    expect(runScript(failClosedScript, { osMajor })).toEqual({ raw_rule: null, boolean_rule: null, integer_rule: null, arm_rule: null })
  })

  it('passes on a newer major when there is no newer branch', () => {
    const noNewerScript = generateBashScript([rawStringPlan({ newerBranch: null })])
    expect(runScript(noNewerScript, { osMajor: '30' })).toEqual({ raw_rule: 'PASS' })
  })

  it('passes on an architecture mismatch and runs the check on a match', () => {
    const armScript = generateBashScript([rawStringPlan({ architecture: 'arm64' })])
    expect(runScript(armScript, { osMajor: '15', arch: 'i386' })).toEqual({ raw_rule: 'PASS' })
    expect(runScript(armScript, { osMajor: '15', arch: 'arm64' })).toEqual({ raw_rule: 'LISTED' })
  })

  it('reports an integer raw value as a JSON number and the pass value when not applicable', () => {
    const integerScript = generateBashScript([
      rawStringPlan({
        dataType: 'Int64',
        operand: 25,
        branches: [{ majors: ['15'], shell: 'echo 25', expected: { type: 'integer', value: 25 } }],
        newerBranch: null,
      }),
    ])
    expect(runScript(integerScript, { osMajor: '15' })).toEqual({ raw_rule: 25 })
    expect(runScript(integerScript, { osMajor: '27' })).toEqual({ raw_rule: 25 })
  })

  it('runs a check containing a heredoc', () => {
    const heredocScript = generateBashScript([
      rawStringPlan({
        branches: [{ majors: ['15'], shell: "/bin/cat << EOS\nfunction run() {\n  return('x')\n}\nEOS", expected: { type: 'string', value: 'PASS' } }],
      }),
    ])
    expect(runScript(heredocScript, { osMajor: '15' })).toEqual({ raw_rule: "function run() {\n  return('x')\n}" })
  })

  it('passes single quotes, $, backticks, backslashes and newlines in check text through the quoting unchanged', () => {
    const awkwardText = "it's \"$HOME\" `date` $(date) \\ back\nsecond line"
    const quotingScript = generateBashScript([
      rawStringPlan({
        branches: [{ majors: ['15'], shell: `/bin/cat << 'EOS'\n${awkwardText}\nEOS`, expected: { type: 'string', value: 'PASS' } }],
      }),
    ])
    expect(runScript(quotingScript, { osMajor: '15' })).toEqual({ raw_rule: awkwardText })
  })

  it('exports a variable-mode ODV verbatim without executing it', () => {
    const odvValue = "Banner with 'quotes' and \"doubles\"\n$(echo EXECUTED) `echo EXECUTED` ${HOME}"
    const odvScript = generateBashScript([
      rawStringPlan({
        reporting: 'boolean',
        dataType: 'Boolean',
        operand: true,
        branches: [
          { majors: ['15'], shell: 'printf \'%s\' "$ODV"', expected: { type: 'string', value: 'PASS' } },
          { majors: ['26'], shell: 'bannerText="$ODV"\ntest "$(printf \'%s\' "$ODV")" = "$bannerText" && echo "1" || echo "0"', expected: { type: 'integer', value: 1 } },
        ],
        newerBranch: null,
        exportedOdv: odvValue,
      }),
    ])
    expect(odvScript).toContain('export ODV=')
    expect(runScript(odvScript, { osMajor: '26' })).toEqual({ raw_rule: true })

    const echoScript = generateBashScript([
      rawStringPlan({
        branches: [{ majors: ['15'], shell: 'printf \'%s\' "$ODV"', expected: { type: 'string', value: 'PASS' } }],
        exportedOdv: odvValue,
      }),
    ])
    expect(runScript(echoScript, { osMajor: '15' })).toEqual({ raw_rule: odvValue })
  })

  it('does not leak a variable-mode ODV into other checks', () => {
    const leakScript = generateBashScript([
      rawStringPlan({ settingName: 'with_odv', branches: [{ majors: ['15'], shell: 'echo "$ODV"', expected: { type: 'string', value: 'PASS' } }], exportedOdv: 'secret' }),
      rawStringPlan({ settingName: 'without_odv', branches: [{ majors: ['15'], shell: 'echo "[${ODV}]"', expected: { type: 'string', value: 'PASS' } }] }),
    ])
    expect(runScript(leakScript, { osMajor: '15' })).toEqual({ with_odv: 'secret', without_odv: '[]' })
  })

  it('makes the preamble variables visible to the checks', () => {
    const preambleScript = generateBashScript([
      rawStringPlan({ branches: [{ majors: ['15'], shell: 'echo "$plb|$arch"', expected: { type: 'string', value: 'PASS' } }] }),
    ])
    expect(runScript(preambleScript, { osMajor: '15', arch: 'i386' })).toEqual({ raw_rule: '/usr/libexec/PlistBuddy|i386' })
  })
})

describe('JSON helpers executed through bash', () => {
  function integerPlan(settingName: string, output: string): RuleCheckPlan {
    return rawStringPlan({
      settingName,
      dataType: 'Int64',
      operand: 0,
      branches: [{ majors: ['15'], shell: `printf '%s' '${output}'`, expected: { type: 'integer', value: 0 } }],
      newerBranch: null,
    })
  }

  it('reports only well-formed JSON integers and null for anything else', () => {
    const script = generateBashScript([
      integerPlan('zero', '0'),
      integerPlan('positive', '42'),
      integerPlan('negative', '-5'),
      integerPlan('leading_zero', '01'),
      integerPlan('negative_zero', '-0'),
      integerPlan('lone_minus', '-'),
      integerPlan('inner_minus', '1-2'),
      integerPlan('double_minus', '--5'),
      integerPlan('spaced', ' 5'),
      integerPlan('empty', ''),
    ])
    expect(runScript(script, { osMajor: '15' })).toEqual({
      zero: 0,
      positive: 42,
      negative: -5,
      leading_zero: null,
      negative_zero: null,
      lone_minus: null,
      inner_minus: null,
      double_minus: null,
      spaced: null,
      empty: null,
    })
  })

  it('escapes backslashes, quotes, newlines, carriage returns, tabs and other control characters', () => {
    const script = generateBashScript([
      rawStringPlan({
        settingName: 'escaped',
        branches: [{ majors: ['15'], shell: "printf 'a\\\\b \"q\"\\nline2\\r\\tx\\001\\037y'", expected: { type: 'string', value: 'PASS' } }],
      }),
      rawStringPlan({ settingName: 'empty', branches: [{ majors: ['15'], shell: 'true', expected: { type: 'string', value: 'PASS' } }] }),
    ])
    expect(runScript(script, { osMajor: '15' })).toEqual({ escaped: 'a\\b "q"\nline2\r\tx\u0001\u001fy', empty: null })
  })

  it('reports multi-line check output as one valid JSON string', () => {
    const script = generateBashScript([
      rawStringPlan({ branches: [{ majors: ['15'], shell: 'echo one\necho two\necho three', expected: { type: 'string', value: 'PASS' } }] }),
    ])
    expect(runScript(script, { osMajor: '15' })).toEqual({ raw_rule: 'one\ntwo\nthree' })
  })
})
