import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { Rule } from '../types/library'
import { buildBundleFiles } from './bundleFiles'
import { classifyRule, packChunks, type GeneratableRule } from './chunking'
import {
  exactlyOneProblem,
  payloadFileDisplay,
  payloadFileProblem,
  publishedFileUrl,
  resolveGeneratedCheckFiles,
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

const ORIGIN = 'https://example.test'

describe('publishedFileUrl', () => {
  it('serves a reference from the published baselines/ folder under the base URL', () => {
    expect(publishedFileUrl('baselines/_overlays/scripts/Fix.ps1', '/app/', ORIGIN)).toBe('/app/baselines/_overlays/scripts/Fix.ps1')
  })

  it.each([
    'baselines/%2e%2e/x.ps1',
    'baselines/%2e%2e/%2e%2e/other/x.ps1',
    'baselines/.%2E/_manifest.json#.ps1',
    'baselines/a#.ps1',
    'baselines/a.ps1?q=1.ps1',
    'baselines/../x.ps1',
    'baselines/./x.ps1',
    'baselines//x.ps1',
    'https://other.test/baselines/x.ps1',
    '/baselines/x.ps1',
  ])('refuses %s', (path) => {
    expect(publishedFileUrl(path, '/app/', ORIGIN)).toBeNull()
  })
})

describe('payloadFileDisplay', () => {
  it('shows a text payload file in full and offers it for download', () => {
    expect(payloadFileDisplay('baselines/_overlays/payloads/Example.mobileconfig', '/app/', ORIGIN)).toEqual({
      fileName: 'Example.mobileconfig',
      url: '/app/baselines/_overlays/payloads/Example.mobileconfig',
      showsContent: true,
    })
  })

  it.each(['Registry.pol', 'App.intunewin'])('offers the binary file %s only as a download', (fileName) => {
    expect(payloadFileDisplay(`baselines/_overlays/payloads/${fileName}`, '/', ORIGIN).showsContent).toBe(false)
  })

  it('offers no link for a reference outside the published folder', () => {
    expect(payloadFileDisplay('baselines/%2e%2e/x.reg', '/', ORIGIN).url).toBeNull()
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

describe('resolveGeneratedCheckFiles', () => {
  it('replaces only the macOS check script files with their text, and leaves the input alone', async () => {
    const step = { name: 'Fix', language: 'powershell' as const, shell_file: 'baselines/_overlays/scripts/Fix.ps1', additional_info: null, versions: null }
    const windowsCheck = {
      language: 'powershell' as const,
      default: { shell_file: 'baselines/_overlays/scripts/Check.ps1', result: null, additional_info: null },
      by_version: {},
    }
    const fileRule = ruleWithCheckFile()
    const rule = { ...fileRule, check: { ...fileRule.check, Windows: windowsCheck }, remediation: { Windows: { steps: [step], payloads: [] } } }
    const loadText = vi.fn(async (path: string) => `text of ${path}`)

    const resolved = await resolveGeneratedCheckFiles(rule, loadText)

    expect(resolved.check?.macOS.default).toEqual({ shell: `text of ${SCRIPT_PATH}`, result: { type: 'integer', value: 1 }, additional_info: null })
    expect(resolved.check?.Windows).toEqual(windowsCheck)
    expect(resolved.remediation).toEqual(rule.remediation)
    expect(loadText.mock.calls).toEqual([[SCRIPT_PATH]])
    expect(fileRule.check?.macOS.default?.shell_file).toBe(SCRIPT_PATH)
  })

  it('fetches nothing for a rule without a macOS check, so a missing Windows script cannot block a bundle', async () => {
    const step = { name: 'Fix', language: 'powershell' as const, shell_file: 'baselines/_overlays/scripts/Missing.ps1', additional_info: null, versions: null }
    const rule = { ...ruleWithInlineCheck(), check: null, remediation: { Windows: { steps: [step], payloads: [] } } }
    const loadText = vi.fn(async () => Promise.reject(new Error('404')))

    await expect(resolveGeneratedCheckFiles(rule, loadText)).resolves.toBe(rule)
    expect(loadText).not.toHaveBeenCalled()
  })

  it('fails when a macOS check script file cannot be loaded', async () => {
    await expect(resolveGeneratedCheckFiles(ruleWithCheckFile(), async () => Promise.reject(new Error('404')))).rejects.toThrow('404')
  })

  it('produces the same bundle as the equivalent inline script', async () => {
    const index = committedVocabularyIndex()
    const bundleOf = (rule: Rule) => {
      const result = classifyRule(rule, { ...createSelectionEntry({ id: rule.id, path: 'mscp/rules/x.json' }), enabled: true }, ['27.0', '26.0', '15.0'], index)
      expect(result.kind).toBe('generatable')
      const chunks = packChunks([(result as { rule: GeneratableRule }).rule], index)
      return buildBundleFiles(chunks, [], [])
    }

    const fromFile = bundleOf(await resolveGeneratedCheckFiles(ruleWithCheckFile(), async () => SCRIPT_TEXT))
    expect(fromFile).toEqual(bundleOf(ruleWithInlineCheck()))
  })
})
