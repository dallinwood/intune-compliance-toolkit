import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateBashScript, type ScriptableRule } from './bash'
import type { AuditStep } from '../../types/rule-detail'

// The real heredoc case from cis_macos26_2.1.1.1.json - a variable
// assignment via command substitution wrapping a heredoc whose terminator
// must sit at column 0. Concatenating rules must never wrap this in a
// function/subshell, or the heredoc parse breaks.
const HEREDOC_STEP: AuditStep = {
  step_role: 'compliance_check',
  original_command: null,
  check_command:
    "cis_macos26_2_1_1_1_icloud_keychain_sync_allowed=$(/usr/bin/osascript -l JavaScript << 'EOS'\n" +
    "$.NSUserDefaults.alloc.initWithSuiteName('com.apple.applicationaccess').objectForKey('allowCloudKeychainSync').js\n" +
    'EOS\n' +
    ')',
  check_command_verified: true,
  output_description: "If the output is 'false', ...",
  output_check: [
    {
      variable: 'cis_macos26_2_1_1_1_icloud_keychain_sync_allowed',
      data_type: 'boolean',
      operator: 'eq',
      value: null,
      value_source: 'organization_defined',
    },
  ],
}

function runScript(script: string): { stdout: string; syntaxOk: boolean } {
  const dir = mkdtempSync(join(tmpdir(), 'bash-scriptgen-'))
  const path = join(dir, 'check.sh')
  writeFileSync(path, script, { encoding: 'utf-8' })

  let syntaxOk = true
  try {
    execFileSync('bash', ['-n', path])
  } catch {
    syntaxOk = false
  }

  const stdout = execFileSync('bash', [path], { encoding: 'utf-8' })
  return { stdout, syntaxOk }
}

describe('generateBashScript', () => {
  it('emits the real heredoc check_command verbatim and unindented, preceded by an id/title comment', () => {
    const script = generateBashScript([{ id: '2.1.1.1', title: 'Audit iCloud Passwords & Keychain', steps: [HEREDOC_STEP] }])

    expect(script).toContain('# --- 2.1.1.1: Audit iCloud Passwords & Keychain ---')
    expect(script).toContain(HEREDOC_STEP.check_command)
  })

  it('starts with a bash shebang and always exits 0', () => {
    const script = generateBashScript([{ id: '1.1', title: 'x', steps: [] }])

    expect(script.startsWith('#!/bin/bash\n')).toBe(true)
    expect(script.trimEnd().endsWith('exit 0')).toBe(true)
  })

  it('flags a step whose check_command_verified is false', () => {
    const script = generateBashScript([
      { id: '1.1', title: 'x', steps: [{ ...HEREDOC_STEP, check_command_verified: false }] },
    ])

    expect(script).toContain('# WARNING: unverified check_command')
  })

  it('produces syntactically valid bash that runs and emits correct single-line JSON', () => {
    const rules: ScriptableRule[] = [
      {
        id: '1.1',
        title: 'Boolean check',
        steps: [
          {
            step_role: 'compliance_check',
            original_command: null,
            check_command: 'test_bool_var=true',
            check_command_verified: true,
            output_description: '',
            output_check: [{ variable: 'test_bool_var', data_type: 'boolean', operator: 'eq', value: true, value_source: 'benchmark' }],
          },
        ],
      },
      {
        id: '1.2',
        title: 'Integer check',
        steps: [
          {
            step_role: 'compliance_check',
            original_command: null,
            check_command: 'test_int_var=42',
            check_command_verified: true,
            output_description: '',
            output_check: [{ variable: 'test_int_var', data_type: 'integer', operator: 'eq', value: 42, value_source: 'benchmark' }],
          },
        ],
      },
      {
        id: '1.3',
        title: 'String check with quotes and a backslash',
        steps: [
          {
            step_role: 'compliance_check',
            original_command: null,
            check_command: String.raw`test_str_var='he said "hi" and used a \backslash\'`,
            check_command_verified: true,
            output_description: '',
            output_check: [{ variable: 'test_str_var', data_type: 'string', operator: 'eq', value: 'x', value_source: 'benchmark' }],
          },
        ],
      },
      {
        id: '1.4',
        title: 'Empty capture normalizes to null, not malformed JSON',
        steps: [
          {
            step_role: 'compliance_check',
            original_command: null,
            check_command: 'test_empty_var=""',
            check_command_verified: true,
            output_description: '',
            output_check: [{ variable: 'test_empty_var', data_type: 'integer', operator: 'eq', value: 0, value_source: 'benchmark' }],
          },
        ],
      },
    ]

    const script = generateBashScript(rules)
    const { stdout, syntaxOk } = runScript(script)

    expect(syntaxOk).toBe(true)
    const parsed = JSON.parse(stdout.trim())
    expect(parsed).toEqual({
      test_bool_var: true,
      test_int_var: 42,
      test_str_var: 'he said "hi" and used a \\backslash\\',
      test_empty_var: null,
    })
  })
})
