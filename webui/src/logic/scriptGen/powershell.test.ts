import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generatePowerShellScript, type ScriptableRule } from './powershell'
import type { AuditStep } from '../../types/rule-detail'

// The real lookup -> compliance_check dependency case from
// cis_intune_win11_1.1.json: the second step's check_command references
// the first step's variable via string interpolation, so verbatim,
// ordered concatenation matters - and the lookup step's own variable
// (empty output_check) must never appear in the JSON output.
const LOOKUP_STEP: AuditStep = {
  step_role: 'lookup',
  original_command: null,
  check_command:
    "$cis_intune_win11_1_1_winning_provider_guid = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\AboveLock' -Name 'AllowCortanaAboveLock_WinningProvider' -ErrorAction SilentlyContinue).AllowCortanaAboveLock_WinningProvider",
  check_command_verified: true,
  output_description: 'This value confirms under which User GUID the policy is set.',
  output_check: [],
}

const COMPLIANCE_CHECK_STEP: AuditStep = {
  step_role: 'compliance_check',
  original_command: null,
  check_command:
    '$cis_intune_win11_1_1_allow_cortana_above_lock = (Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\Providers\\$cis_intune_win11_1_1_winning_provider_guid\\Default\\Device\\AboveLock" -Name \'AllowCortanaAboveLock\' -ErrorAction SilentlyContinue).AllowCortanaAboveLock',
  check_command_verified: false,
  output_description: 'confirm the value is set to 0',
  output_check: [
    { variable: 'cis_intune_win11_1_1_allow_cortana_above_lock', data_type: 'integer', operator: 'eq', value: 0, value_source: 'benchmark' },
  ],
}

function runScript(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ps-scriptgen-'))
  const path = join(dir, 'check.ps1')
  writeFileSync(path, script, { encoding: 'utf-8' })
  return execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', path], { encoding: 'utf-8' })
}

describe('generatePowerShellScript', () => {
  it('emits both real steps verbatim and in order, warning on the unverified one', () => {
    const script = generatePowerShellScript([
      { id: '1.1', title: "Ensure 'Allow Cortana Above Lock' is set to 'Block'", steps: [LOOKUP_STEP, COMPLIANCE_CHECK_STEP] },
    ])

    expect(script).toContain(LOOKUP_STEP.check_command)
    expect(script).toContain(COMPLIANCE_CHECK_STEP.check_command)
    expect(script.indexOf(LOOKUP_STEP.check_command)).toBeLessThan(script.indexOf(COMPLIANCE_CHECK_STEP.check_command))
    expect(script).toContain('# WARNING: unverified check_command')
  })

  it('excludes a lookup-only variable (empty output_check) from the JSON output hashtable', () => {
    const script = generatePowerShellScript([{ id: '1.1', title: 'x', steps: [LOOKUP_STEP, COMPLIANCE_CHECK_STEP] }])

    // The lookup command itself must still run verbatim (asserted above) -
    // only its presence as a hashtable *entry* (i.e. in the JSON output) is
    // what must be excluded.
    expect(script).not.toContain("'cis_intune_win11_1_1_winning_provider_guid' =")
    expect(script).toContain("'cis_intune_win11_1_1_allow_cortana_above_lock' =")
  })

  it('always exits 0', () => {
    const script = generatePowerShellScript([{ id: '1.1', title: 'x', steps: [] }])

    expect(script.trimEnd().endsWith('exit 0')).toBe(true)
  })

  it('produces a script that runs under real PowerShell and emits correctly-typed compact JSON', () => {
    const rules: ScriptableRule[] = [
      {
        id: '1.1',
        title: 'Boolean and integer check',
        steps: [
          {
            step_role: 'compliance_check',
            original_command: null,
            check_command: '$test_bool_var = $true',
            check_command_verified: true,
            output_description: '',
            output_check: [{ variable: 'test_bool_var', data_type: 'boolean', operator: 'eq', value: true, value_source: 'benchmark' }],
          },
        ],
      },
      {
        id: '1.2',
        title: 'String check',
        steps: [
          {
            step_role: 'compliance_check',
            original_command: null,
            check_command: '$test_str_var = \'he said "hi"\'',
            check_command_verified: true,
            output_description: '',
            output_check: [{ variable: 'test_str_var', data_type: 'string', operator: 'eq', value: 'x', value_source: 'benchmark' }],
          },
        ],
      },
    ]

    const script = generatePowerShellScript(rules)
    const stdout = runScript(script)
    const parsed = JSON.parse(stdout.trim())

    expect(parsed).toEqual({ test_bool_var: true, test_str_var: 'he said "hi"' })
  })
})
