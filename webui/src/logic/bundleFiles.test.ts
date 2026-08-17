import { describe, expect, it } from 'vitest'
import { buildBundleFiles } from './bundleFiles'
import type { GeneratableRule, ManualAttestationEntry } from './chunking'
import type { Chunk } from './chunking'

function ruleWithStep(id: string, platform: string, variable: string): GeneratableRule {
  return {
    ref: { family: 'cis', product: 'p', version: 'v1', file: `${id}.json`, id },
    id,
    title: `Rule ${id}`,
    platform,
    steps: [
      {
        step_role: 'compliance_check',
        original_command: null,
        check_command: `${variable}=1`,
        check_command_verified: true,
        output_description: '',
        output_check: [{ variable, data_type: 'integer', operator: 'eq', value: 1, value_source: 'benchmark' }],
      },
    ],
    ruleEntries: [
      {
        SettingName: variable,
        Operator: 'IsEquals',
        DataType: 'Int64',
        Operand: 1,
        RemediationStrings: [{ Language: 'en_US', Title: `Rule ${id}`, Description: 'd' }],
      },
    ],
  }
}

describe('buildBundleFiles', () => {
  it('emits a bash discovery script + rules JSON for a macOS chunk, and a PowerShell pair for a Windows chunk', () => {
    const chunks: Chunk[] = [
      {
        platform: 'macOS',
        section: '2',
        partNumber: null,
        rules: [ruleWithStep('2.1.1.1', 'macOS', 'mac_var')],
        ruleEntries: [ruleWithStep('2.1.1.1', 'macOS', 'mac_var').ruleEntries[0]],
      },
      {
        platform: 'Windows 11 (Intune)',
        section: '1',
        partNumber: 1,
        rules: [ruleWithStep('1.1', 'Windows 11 (Intune)', 'win_var')],
        ruleEntries: [ruleWithStep('1.1', 'Windows 11 (Intune)', 'win_var').ruleEntries[0]],
      },
    ]

    const files = buildBundleFiles(chunks, [])
    const paths = files.map((file) => file.path)

    expect(paths).toContain('macos-section-2-discovery.sh')
    expect(paths).toContain('macos-section-2-rules.json')
    expect(paths).toContain('windows-11-intune-section-1-part-1-discovery.ps1')
    expect(paths).toContain('windows-11-intune-section-1-part-1-rules.json')
    expect(paths).toContain('manual-attestation.md')

    const bashScript = files.find((file) => file.path === 'macos-section-2-discovery.sh')!.content
    expect(bashScript).toContain('mac_var=1')

    const rulesJson = JSON.parse(files.find((file) => file.path === 'macos-section-2-rules.json')!.content)
    expect(rulesJson.Rules[0].SettingName).toBe('mac_var')
  })

  it('always includes a manual-attestation.md even when there are no manual entries', () => {
    const files = buildBundleFiles([], [] as ManualAttestationEntry[])

    expect(files.map((file) => file.path)).toEqual(['manual-attestation.md'])
  })
})
