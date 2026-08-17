import { describe, expect, it } from 'vitest'
import { buildBundleFiles } from './bundleFiles'
import type { GeneratableRule, ManualAttestationEntry } from './chunking'
import type { Chunk } from './chunking'

function ruleWithStep(id: string, platform: string, variable: string, refOverrides: Partial<GeneratableRule['ref']> = {}): GeneratableRule {
  return {
    ref: { family: 'cis', product: 'p', version: 'v1', file: `${id}.json`, id, ...refOverrides },
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
  it('names files as {platform}-{family}-{product}-{version}-{firstId}-{lastId}, showing the range of rule ids included', () => {
    const macRule = ruleWithStep('2.1.1.1', 'macOS', 'mac_var', { product: 'macos_26_tahoe', version: 'v1.1.0' })
    const winRule = ruleWithStep('1.1', 'Windows 11 (Intune)', 'win_var', { product: 'windows_11', version: 'v5.0.0' })
    const chunks: Chunk[] = [
      {
        platform: 'macOS',
        family: 'cis',
        product: 'macos_26_tahoe',
        version: 'v1.1.0',
        section: '2',
        partNumber: null,
        rules: [macRule],
        ruleEntries: [macRule.ruleEntries[0]],
      },
      {
        platform: 'Windows 11 (Intune)',
        family: 'cis',
        product: 'windows_11',
        version: 'v5.0.0',
        section: '1',
        partNumber: 1,
        rules: [winRule],
        ruleEntries: [winRule.ruleEntries[0]],
      },
    ]

    const files = buildBundleFiles(chunks, [])
    const paths = files.map((file) => file.path)

    expect(paths).toContain('macOS-cis-macos_26_tahoe-v1.1.0-2.1.1.1-2.1.1.1-discovery.sh')
    expect(paths).toContain('macOS-cis-macos_26_tahoe-v1.1.0-2.1.1.1-2.1.1.1-rules.json')
    expect(paths).toContain('Windows-cis-windows_11-v5.0.0-1.1-1.1-discovery.ps1')
    expect(paths).toContain('Windows-cis-windows_11-v5.0.0-1.1-1.1-rules.json')
    expect(paths).toContain('manual-attestation.md')

    const bashScript = files.find((file) => file.path === 'macOS-cis-macos_26_tahoe-v1.1.0-2.1.1.1-2.1.1.1-discovery.sh')!.content
    expect(bashScript).toContain('mac_var=1')

    const rulesJson = JSON.parse(files.find((file) => file.path === 'macOS-cis-macos_26_tahoe-v1.1.0-2.1.1.1-2.1.1.1-rules.json')!.content)
    expect(rulesJson.Rules[0].SettingName).toBe('mac_var')
  })

  it('uses the first and last rule id of the chunk (already naturally sorted) for a multi-rule chunk', () => {
    const rules = [
      ruleWithStep('1.1.1', 'macOS', 'var_a'),
      ruleWithStep('1.2.3', 'macOS', 'var_b'),
      ruleWithStep('1.5.6', 'macOS', 'var_c'),
    ]
    const chunk: Chunk = {
      platform: 'macOS',
      family: 'cis',
      product: 'macos_26_tahoe',
      version: 'v1.1.0',
      section: '1',
      partNumber: null,
      rules,
      ruleEntries: rules.flatMap((rule) => rule.ruleEntries),
    }

    const paths = buildBundleFiles([chunk], []).map((file) => file.path)

    expect(paths).toContain('macOS-cis-macos_26_tahoe-v1.1.0-1.1.1-1.5.6-discovery.sh')
  })

  it('always includes a manual-attestation.md even when there are no manual entries', () => {
    const files = buildBundleFiles([], [] as ManualAttestationEntry[])

    expect(files.map((file) => file.path)).toEqual(['manual-attestation.md'])
  })

  it('throws a clear error rather than silently dropping a file if two chunks would produce the same filename', () => {
    const ruleA = ruleWithStep('1.1', 'macOS', 'var_a')
    const ruleB = ruleWithStep('1.1', 'macOS', 'var_b')
    const chunk = (rule: GeneratableRule): Chunk => ({
      platform: 'macOS',
      family: 'cis',
      product: 'macos_26_tahoe',
      version: 'v1.1.0',
      section: '1',
      partNumber: null,
      rules: [rule],
      ruleEntries: rule.ruleEntries,
    })

    expect(() => buildBundleFiles([chunk(ruleA), chunk(ruleB)], [])).toThrow(/same name/i)
  })
})
