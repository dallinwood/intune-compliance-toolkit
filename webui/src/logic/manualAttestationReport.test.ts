import { describe, expect, it } from 'vitest'
import type { ManualReason } from '../types/library'
import { additionalInfoFor, buildManualAttestationMarkdown, manualReasonText } from './manualAttestationReport'
import { inlineRule, ruleCheck } from './testRuleFixtures'
import { committedVocabularyIndex, vocabularyIndexOf } from './testVocabularyFixtures'

const vocabularyIndex = committedVocabularyIndex()

function manualRule(manualReason: ManualReason | null, additionalInfo: string | null = null) {
  return inlineRule({
    overrides: {
      assessment: { status: 'manual', manual_reason: manualReason },
      check: { default: ruleCheck(null, null, additionalInfo), by_version: {} },
    },
  })
}

describe('manualReasonText', () => {
  it.each<[ManualReason, string]>([
    ['inherent', 'Met by macOS by design (mSCP: inherent).'],
    ['permanent', 'Cannot be configured on macOS; mSCP lists this as a permanent finding.'],
    ['n_a', 'Not applicable to macOS (mSCP: n_a).'],
    ['supplemental', 'Supplemental guidance with no check.'],
    ['manual', 'mSCP marks this check as manual.'],
    ['no_check', 'The source provides no automated check.'],
  ])('explains manual_reason %s with the vocabulary description', (manualReason, text) => {
    expect(manualReasonText(manualReason, vocabularyIndex)).toBe(text)
  })

  it('treats a missing reason like an explicit "manual"', () => {
    expect(manualReasonText(null, vocabularyIndex)).toBe('mSCP marks this check as manual.')
  })

  it('names the raw reason code when the vocabulary has no description for it', () => {
    const withoutDescription = vocabularyIndexOf({ manual_reasons: [{ label: 'inherent', terms: ['inherent'] }] })
    expect(manualReasonText('inherent', withoutDescription)).toBe('mSCP manual reason: inherent.')
    expect(manualReasonText('n_a', vocabularyIndexOf({}))).toBe('mSCP manual reason: n_a.')
    expect(manualReasonText(null, vocabularyIndexOf({}))).toBe('mSCP manual reason: manual.')
  })
})

describe('additionalInfoFor', () => {
  it('is null when the check has no additional_info', () => {
    expect(additionalInfoFor(manualRule('inherent'), null)).toBeNull()
  })

  it('is the check additional_info, trimmed', () => {
    expect(additionalInfoFor(manualRule('manual', 'Ask the ISSO.\n\nThen record it.\n'), null)).toBe('Ask the ISSO.\n\nThen record it.')
  })

  it('shows the effective value instead of $ODV', () => {
    expect(additionalInfoFor(manualRule('manual', 'Require $ODV characters.'), 15)).toBe('Require 15 characters.')
  })
})

describe('buildManualAttestationMarkdown', () => {
  it('notes when nothing requires manual attestation', () => {
    expect(buildManualAttestationMarkdown([])).toMatch(/No selected rules need manual attestation\./)
  })

  it('lists each entry by upstream id and title, with the reason and any additional_info indented under it', () => {
    const markdown = buildManualAttestationMarkdown([
      {
        id: 'mscp.pwpolicy_temporary_or_emergency_accounts_disable',
        title: 'Disable Temporary Accounts',
        reason: 'mSCP marks this check as manual.',
        additionalInfo: 'Ask the ISSO.\n\nThen record it.',
      },
    ])

    expect(markdown).toContain(
      '- **pwpolicy_temporary_or_emergency_accounts_disable** - Disable Temporary Accounts\n\n' +
        '  mSCP marks this check as manual.\n\n  Ask the ISSO.\n\n  Then record it.\n',
    )
    expect(markdown).not.toContain('mscp.pwpolicy_temporary')
  })

  it('credits mSCP under CC BY 4.0', () => {
    const markdown = buildManualAttestationMarkdown([{ id: 'mscp.os_x', title: 'X', reason: 'Y', additionalInfo: null }])

    expect(markdown).toContain('https://github.com/usnistgov/macos_security')
    expect(markdown).toContain('https://creativecommons.org/licenses/by/4.0/')
  })
})
