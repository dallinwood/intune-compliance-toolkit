import { describe, expect, it } from 'vitest'
import type { RemediationPayload, RemediationStep } from '../types/library'
import {
  newestVersionsFirst,
  remediationItemButtonLabel,
  remediationPayloadLabel,
  remediationStepLabel,
  scriptLanguageLabel,
  showsRemediationSection,
  targetHeading,
} from './targetDisplay'
import { committedVocabularyIndex, vocabularyIndexOf } from './testVocabularyFixtures'

const index = committedVocabularyIndex()

function step(overrides: Partial<RemediationStep> = {}): RemediationStep {
  return { name: null, language: 'bash', shell: 'fix', additional_info: null, versions: null, ...overrides }
}

function payload(overrides: Partial<RemediationPayload> = {}): RemediationPayload {
  return { kind: 'mobileconfig', versions: null, data: {}, ...overrides }
}

describe('scriptLanguageLabel', () => {
  it.each([
    ['bash', 'Bash'],
    ['powershell', 'PowerShell'],
    ['zsh', 'zsh'],
    ['python', 'Python'],
  ] as const)('labels %s as %s', (language, label) => {
    expect(scriptLanguageLabel(language)).toBe(label)
  })
})

describe('targetHeading', () => {
  it('names the target and its one language', () => {
    expect(targetHeading(index, 'macOS', ['bash'])).toBe('macOS · Bash')
    expect(targetHeading(index, 'Windows', ['powershell', 'powershell'])).toBe('Windows · PowerShell')
  })

  it('names only the target when there is no language or more than one', () => {
    expect(targetHeading(index, 'macOS', [])).toBe('macOS')
    expect(targetHeading(index, 'Windows', ['powershell', 'python'])).toBe('Windows')
  })

  it('uses the targets vocabulary label when there is one', () => {
    const labelled = vocabularyIndexOf({ targets: [{ label: 'Microsoft Windows', terms: ['Windows'] }] })
    expect(targetHeading(labelled, 'Windows', ['powershell'])).toBe('Microsoft Windows · PowerShell')
  })
})

describe('remediationStepLabel', () => {
  it('is Fix for an unnamed step that applies to every version', () => {
    expect(remediationStepLabel(index, 'macOS', step())).toBe('Fix')
  })

  it('names the versions a step is limited to, in list order, through the versions vocabulary', () => {
    expect(remediationStepLabel(index, 'macOS', step({ versions: ['15.0'] }))).toBe('Fix for macOS 15')
    expect(remediationStepLabel(index, 'macOS', step({ versions: ['15.0', '27.0'] }))).toBe('Fix for macOS 15, macOS 27')
  })

  it('uses the step name when it has one', () => {
    expect(remediationStepLabel(index, 'Windows', step({ name: 'BlockCerts' }))).toBe('BlockCerts')
    expect(remediationStepLabel(index, 'Windows', step({ name: 'BlockCerts', versions: ['24H2'] }))).toBe('BlockCerts for Windows 24H2')
  })
})

describe('remediationPayloadLabel', () => {
  it('labels the mSCP payload kinds and keeps any other kind as written', () => {
    expect(remediationPayloadLabel(index, 'macOS', payload())).toBe('Configuration profile payloads')
    expect(remediationPayloadLabel(index, 'macOS', payload({ kind: 'ddm' }))).toBe('Declarative Device Management')
    expect(remediationPayloadLabel(index, 'Windows', payload({ kind: 'registry' }))).toBe('registry')
  })

  it('names the versions a payload is limited to', () => {
    expect(remediationPayloadLabel(index, 'macOS', payload({ versions: ['15.0'] }))).toBe('Configuration profile payloads for macOS 15')
  })
})

describe('remediationItemButtonLabel', () => {
  it('names a step by its script language, with no suffix when it covers every version', () => {
    expect(remediationItemButtonLabel(index, 'macOS', { type: 'step', step: step() })).toBe('Bash script')
    expect(remediationItemButtonLabel(index, 'Windows', { type: 'step', step: step({ language: 'powershell' }) })).toBe('PowerShell script')
  })

  it('names a payload by the same kind names as the payload label, in singular form', () => {
    expect(remediationItemButtonLabel(index, 'macOS', { type: 'payload', payload: payload() })).toBe('Configuration profile')
    expect(remediationItemButtonLabel(index, 'macOS', { type: 'payload', payload: payload({ kind: 'ddm' }) })).toBe('DDM declaration')
    expect(remediationItemButtonLabel(index, 'Windows', { type: 'payload', payload: payload({ kind: 'registry' }) })).toBe('registry')
  })

  it('adds the version scope when the item does not cover every version', () => {
    expect(remediationItemButtonLabel(index, 'macOS', { type: 'payload', payload: payload({ versions: ['15.0'] }) })).toBe(
      'Configuration profile · macOS 15',
    )
    expect(remediationItemButtonLabel(index, 'macOS', { type: 'step', step: step({ versions: ['15.0', '27.0'] }) })).toBe(
      'Bash script · macOS 15, macOS 27',
    )
  })
})

describe('showsRemediationSection', () => {
  it('shows a remediation that exists', () => {
    expect(showsRemediationSection({ remediation: { macOS: { steps: [step()], payloads: [] } }, applicability: [] })).toBe(true)
  })

  it('shows the empty section for a rule with a named target and no remediation', () => {
    const applicability = [{ target: 'macOS', version: '27.0', benchmarks: [] }]
    expect(showsRemediationSection({ remediation: null, applicability })).toBe(true)
  })

  it('hides it for a rule with no remediation and no named target, such as an ISM control', () => {
    const applicability = [{ target: null, version: null, benchmarks: [] }]
    expect(showsRemediationSection({ remediation: null, applicability })).toBe(false)
  })
})

describe('newestVersionsFirst', () => {
  it('puts all-version entries first, then orders by each entry\'s highest version, newest first', () => {
    const entries = [
      step({ shell: 'fifteen', versions: ['15.0'] }),
      step({ shell: 'default', versions: ['26.0', '27.0'] }),
      step({ shell: 'twenty-six', versions: ['26.0'] }),
      step({ shell: 'everywhere' }),
    ]
    expect(newestVersionsFirst(entries).map((entry) => entry.shell)).toEqual(['everywhere', 'default', 'twenty-six', 'fifteen'])
  })

  it('keeps list order between entries that tie, and does not change its input', () => {
    const entries = [step({ shell: 'first' }), step({ shell: 'second' }), payload({ versions: ['15.0'] })]
    const before = [...entries]
    expect(newestVersionsFirst(entries)).toEqual(entries)
    expect(entries).toEqual(before)
  })
})
