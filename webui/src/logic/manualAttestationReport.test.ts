import { describe, expect, it } from 'vitest'
import type { ManifestSource, ManualReason } from '../types/library'
import { additionalInfoFor, buildManualAttestationMarkdown, manualReasonText } from './manualAttestationReport'
import { inlineRule, macosCheck, ruleCheck } from './testRuleFixtures'
import { committedVocabularyIndex, vocabularyIndexOf } from './testVocabularyFixtures'

const vocabularyIndex = committedVocabularyIndex()

function manifestSource(name: string, displayName: string, repositoryUrl: string): ManifestSource {
  return {
    name,
    display_name: displayName,
    release_tag: 'release_1',
    commit_sha: 'abc',
    index_path: `${name}/_index.json`,
    repository_url: repositoryUrl,
    retrieved_date: '2026-10-23',
    rule_count: 1,
    license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', rights_holder: 'Someone', modified: true },
  }
}

const MSCP_SOURCE = manifestSource('mscp', 'NIST macOS Security Compliance Project', 'https://github.com/usnistgov/macos_security')
const ISM_SOURCE = manifestSource('asd_ism', 'ASD Information Security Manual', 'https://github.com/AustralianCyberSecurityCentre/ism-oscal')
const SOURCES = [MSCP_SOURCE, ISM_SOURCE]

const MSCP_ATTRIBUTION =
  'Rule content from the NIST macOS Security Compliance Project (https://github.com/usnistgov/macos_security), ' +
  'licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Content modified by this project.'
const ISM_ATTRIBUTION =
  'Rule content from the ASD Information Security Manual (https://github.com/AustralianCyberSecurityCentre/ism-oscal), ' +
  'licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Content modified by this project.'

const MSCP_ENTRY = { id: 'mscp.os_x', title: 'X', reason: 'Y', additionalInfo: null }
const ISM_ENTRY = { id: 'asd_ism.ism-1667', title: 'Z', reason: 'Y', additionalInfo: null }

function manualRule(manualReason: ManualReason | null, additionalInfo: string | null = null) {
  return inlineRule({
    overrides: {
      assessment: { status: 'manual', manual_reason: manualReason },
      check: macosCheck(ruleCheck(null, null, additionalInfo)),
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

  it('reads only the macOS check, since the report ships with the macOS bundle', () => {
    const rule = manualRule('manual')
    rule.check = {
      Windows: { language: 'powershell', default: ruleCheck(null, null, 'Ask the Windows team.'), by_version: {} },
    }
    expect(additionalInfoFor(rule, null)).toBeNull()
    rule.check = { ...macosCheck(ruleCheck(null, null, 'Ask the ISSO.')), ...rule.check }
    expect(additionalInfoFor(rule, null)).toBe('Ask the ISSO.')
  })

  it('shows the effective value instead of $ODV', () => {
    expect(additionalInfoFor(manualRule('manual', 'Require $ODV characters.'), 15)).toBe('Require 15 characters.')
  })
})

describe('buildManualAttestationMarkdown', () => {
  it('notes when nothing requires manual attestation', () => {
    expect(buildManualAttestationMarkdown([], SOURCES)).toMatch(/No selected rules need manual attestation\./)
  })

  it('lists each entry by upstream id and title, with the reason and any additional_info indented under it', () => {
    const markdown = buildManualAttestationMarkdown([
      {
        id: 'mscp.pwpolicy_temporary_or_emergency_accounts_disable',
        title: 'Disable Temporary Accounts',
        reason: 'mSCP marks this check as manual.',
        additionalInfo: 'Ask the ISSO.\n\nThen record it.',
      },
    ], SOURCES)

    expect(markdown).toContain(
      '- **pwpolicy_temporary_or_emergency_accounts_disable** - Disable Temporary Accounts\n\n' +
        '  mSCP marks this check as manual.\n\n  Ask the ISSO.\n\n  Then record it.\n',
    )
    expect(markdown).not.toContain('mscp.pwpolicy_temporary')
  })

  it('ends an mSCP-only report with the NIST attribution and nothing else', () => {
    const markdown = buildManualAttestationMarkdown([MSCP_ENTRY], SOURCES)

    expect(markdown.endsWith(`---

${MSCP_ATTRIBUTION}
`)).toBe(true)
    expect(markdown).not.toContain('ASD Information Security Manual')
  })

  it('credits each source present, asd_ism before mscp, whatever order the entries and sources come in', () => {
    const markdown = buildManualAttestationMarkdown([MSCP_ENTRY, ISM_ENTRY], SOURCES)

    expect(markdown.endsWith(`---

${ISM_ATTRIBUTION}
${MSCP_ATTRIBUTION}
`)).toBe(true)
  })

  it('credits only the sources that have an entry', () => {
    const markdown = buildManualAttestationMarkdown([ISM_ENTRY], SOURCES)

    expect(markdown.endsWith(`---

${ISM_ATTRIBUTION}
`)).toBe(true)
    expect(markdown).not.toContain('NIST macOS Security Compliance Project')
  })

  it('has no bare separator when no entry matches a source', () => {
    const markdown = buildManualAttestationMarkdown([{ id: 'unknown.rule_x', title: 'X', reason: 'Y', additionalInfo: null }], SOURCES)

    expect(markdown).not.toContain('---')
    expect(markdown).not.toContain('Rule content from')
  })

  it('has no attribution block when there are no entries', () => {
    const markdown = buildManualAttestationMarkdown([], SOURCES)

    expect(markdown).not.toContain('---')
    expect(markdown).not.toContain('Rule content from')
  })
})
