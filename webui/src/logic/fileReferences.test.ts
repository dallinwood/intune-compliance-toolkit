import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { Rule } from '../types/library'
import { buildBundleFiles } from './bundleFiles'
import { classifyRule, packChunks, type GeneratableRule } from './chunking'
import {
  exactlyOneProblem,
  payloadFileDisplay,
  payloadFileProblem,
  resolveScriptFiles,
  scriptFileProblem,
} from './fileReferences'
import { createSelectionEntry } from './selectionEntry'
import { inlineRule, macosCheck, ruleCheck } from './testRuleFixtures'
import { committedVocabularyIndex } from './testVocabularyFixtures'

interface FileReferenceCase {
  name: string
  kind: 'script' | 'payload'
  entry: Record<string, unknown>
  language?: string
  error: boolean
}

const CASES = JSON.parse(readFileSync(new URL('../../../tests/fixtures/overlays/cases.json', import.meta.url), 'utf8')) as {
  file_reference_cases: FileReferenceCase[]
}

function referenceProblem(fileCase: FileReferenceCase): string | null {
  const { entry } = fileCase
  if (fileCase.kind === 'script') {
    return exactlyOneProblem(entry, 'shell', 'shell_file') ?? (Object.hasOwn(entry, 'shell_file') ? scriptFileProblem(entry.shell_file, fileCase.language) : null)
  }
  return exactlyOneProblem(entry, 'data', 'data_file') ?? (Object.hasOwn(entry, 'data_file') ? payloadFileProblem(entry.data_file) : null)
}

describe('shared file reference cases', () => {
  it.each(CASES.file_reference_cases.map((fileCase) => [fileCase.name, fileCase] as const))('%s', (_name, fileCase) => {
    expect(referenceProblem(fileCase) !== null).toBe(fileCase.error)
  })
})

describe('payloadFileDisplay', () => {
  it('shows a text payload file in full and offers it for download', () => {
    expect(payloadFileDisplay('baselines/_overlays/payloads/Example.mobileconfig', '/app/')).toEqual({
      fileName: 'Example.mobileconfig',
      url: '/app/baselines/_overlays/payloads/Example.mobileconfig',
      showsContent: true,
    })
  })

  it.each(['Registry.pol', 'App.intunewin', 'UPPER.POL'])('offers the binary file %s only as a download', (fileName) => {
    expect(payloadFileDisplay(`baselines/_overlays/payloads/${fileName}`, '/').showsContent).toBe(false)
  })
})

const SCRIPT_PATH = 'baselines/_overlays/scripts/check.sh'
const SCRIPT_TEXT = '/usr/bin/defaults read com.example key'

function ruleWithCheckFile(): Rule {
  return inlineRule({
    upstreamId: 'os_file_check',
    overrides: { check: macosCheck({ shell_file: SCRIPT_PATH, result: { type: 'integer', value: 1 }, additional_info: null }) },
  })
}

function ruleWithInlineCheck(): Rule {
  return inlineRule({ upstreamId: 'os_file_check', overrides: { check: macosCheck(ruleCheck(SCRIPT_TEXT, { type: 'integer', value: 1 })) } })
}

describe('resolveScriptFiles', () => {
  it('replaces every shell_file with the file text as shell, and leaves inline scripts and the input alone', async () => {
    const step = { name: 'Fix', language: 'powershell' as const, shell_file: 'baselines/_overlays/scripts/Fix.ps1', additional_info: null, versions: null }
    const inlineStep = { name: null, language: 'bash' as const, shell: 'echo inline', additional_info: null, versions: null }
    const rule = { ...ruleWithCheckFile(), remediation: { Windows: { steps: [step, inlineStep], payloads: [] } } }
    const loadText = vi.fn(async (path: string) => `text of ${path}`)

    const resolved = await resolveScriptFiles(rule, loadText)

    expect(resolved.check?.macOS.default).toEqual({ shell: `text of ${SCRIPT_PATH}`, result: { type: 'integer', value: 1 }, additional_info: null })
    expect(resolved.remediation?.Windows.steps).toEqual([
      { name: 'Fix', language: 'powershell', shell: 'text of baselines/_overlays/scripts/Fix.ps1', additional_info: null, versions: null },
      inlineStep,
    ])
    expect(rule.check?.macOS.default?.shell_file).toBe(SCRIPT_PATH)
  })

  it('fails when a referenced file cannot be loaded', async () => {
    await expect(resolveScriptFiles(ruleWithCheckFile(), async () => Promise.reject(new Error('404')))).rejects.toThrow('404')
  })

  it('produces the same bundle as the equivalent inline script', async () => {
    const index = committedVocabularyIndex()
    const bundleOf = (rule: Rule) => {
      const result = classifyRule(rule, { ...createSelectionEntry({ id: rule.id, path: 'mscp/rules/x.json' }), enabled: true }, ['27.0', '26.0', '15.0'], index)
      expect(result.kind).toBe('generatable')
      const chunks = packChunks([(result as { rule: GeneratableRule }).rule], index)
      return buildBundleFiles(chunks, [], [])
    }

    const fromFile = bundleOf(await resolveScriptFiles(ruleWithCheckFile(), async () => SCRIPT_TEXT))
    expect(fromFile).toEqual(bundleOf(ruleWithInlineCheck()))
  })
})
