import { describe, expect, it } from 'vitest'
import { buildManualAttestationMarkdown } from './manualAttestationReport'
import type { ManualAttestationEntry } from './chunking'

describe('buildManualAttestationMarkdown', () => {
  it('notes when nothing requires manual attestation', () => {
    expect(buildManualAttestationMarkdown([])).toMatch(/no rules require manual attestation/i)
  })

  it('lists each entry with its id, title, and reason', () => {
    const entries: ManualAttestationEntry[] = [
      {
        ref: { family: 'cis', product: 'macos_26_tahoe', version: 'v1.1.0', file: 'x.json', id: '2.1.1.1' },
        id: '2.1.1.1',
        title: 'Audit iCloud Passwords & Keychain',
        reason: 'No scripted audit method is available for this rule.',
      },
    ]

    const markdown = buildManualAttestationMarkdown(entries)

    expect(markdown).toContain('2.1.1.1')
    expect(markdown).toContain('Audit iCloud Passwords & Keychain')
    expect(markdown).toContain('No scripted audit method is available for this rule.')
  })
})
