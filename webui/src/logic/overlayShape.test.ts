import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Manifest, RuleIndex } from '../types/library'
import { applyOverlayFields } from './overlays'
import { indexEntryShapeProblem, ruleShapeProblem } from './overlayShape'

const BASELINES_DIRECTORY = new URL('../../../baselines/', import.meta.url)

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, BASELINES_DIRECTORY), 'utf8')) as T
}

const manifest = readJson<Manifest>('_manifest.json')

// The shape checks must never reject imported data, or an overlay that adds
// a tag would be dropped for upstream reasons.
describe('the shape checks accept the whole committed library', () => {
  for (const source of manifest.sources) {
    for (const release of source.releases) {
      const releaseDirectory = release.index_path.replace(/_index\.json$/, '')
      const index = readJson<RuleIndex>(release.index_path)
      const ruleFiles = readdirSync(new URL(`${releaseDirectory}rules/`, BASELINES_DIRECTORY))
      const rules = ruleFiles.map((fileName) => readJson(`${releaseDirectory}rules/${fileName}`))

      it(`${source.name} ${release.tag} index entries and rules`, () => {
        const entryProblems = index.rules.map((entry) => indexEntryShapeProblem(entry)).filter((problem) => problem !== null)
        const ruleProblems = rules.map((rule) => ruleShapeProblem(rule)).filter((problem) => problem !== null)

        expect(entryProblems).toEqual([])
        expect(ruleProblems).toEqual([])
        expect(ruleFiles.length).toBe(index.rules.length)
      })
    }
  }
})


describe('the shape checks accept the openscap manual reason', () => {
  it('accepts manual_reason openscap on a rule', () => {
    const [source] = manifest.sources
    const releaseDirectory = source.releases[0].index_path.replace(/_index\.json$/, '')
    const [ruleFileName] = readdirSync(new URL(`${releaseDirectory}rules/`, BASELINES_DIRECTORY))
    const rule = readJson<Record<string, unknown>>(`${releaseDirectory}rules/${ruleFileName}`)

    const openscapRule = { ...rule, assessment: { status: 'manual', manual_reason: 'openscap' } }

    expect(ruleShapeProblem(openscapRule)).toBeNull()
  })
})

interface RuleShapeCase {
  name: string
  rule: Record<string, unknown>
  fields: Record<string, unknown>
  error: boolean
}

const SHARED_CASES = JSON.parse(readFileSync(new URL('../../../tests/fixtures/overlays/cases.json', import.meta.url), 'utf8')) as {
  rule_shape_cases: RuleShapeCase[]
}

function committedRule(): Record<string, unknown> {
  const [source] = manifest.sources
  const releaseDirectory = source.releases[0].index_path.replace(/_index\.json$/, '')
  const [ruleFileName] = readdirSync(new URL(`${releaseDirectory}rules/`, BASELINES_DIRECTORY))
  return readJson<Record<string, unknown>>(`${releaseDirectory}rules/${ruleFileName}`)
}

// The same file tests/test_overlays.py runs: each case merges fields into a
// rule, and the merged check list must pass or fail the rule shape the same
// way the schema does.
describe('shared rule shape cases', () => {
  it.each(SHARED_CASES.rule_shape_cases.map((shapeCase) => [shapeCase.name, shapeCase] as const))('%s', (_name, shapeCase) => {
    const merged = applyOverlayFields(shapeCase.rule, shapeCase.fields) as Record<string, unknown>

    const problem = ruleShapeProblem({ ...committedRule(), check: merged.check })

    expect(problem !== null).toBe(shapeCase.error)
  })
})

function ruleWithWindowsCheck(item: Record<string, unknown>): Record<string, unknown> {
  return { ...committedRule(), check: { Windows: [item] } }
}

const REGISTRY_SETTING = { hive: 'HKLM', path: 'SOFTWARE\\Example', value_name: 'Enabled', type: 'REG_DWORD', data: 1, state: 'present' }

describe('registry, ansible and goss in the shape checks', () => {
  const registryItem = (body: Record<string, unknown>) => ({
    name: null,
    language: 'registry',
    default: { result: null, additional_info: null, ...body },
    by_version: {},
  })

  it('accepts a registry check item with a settings list', () => {
    expect(ruleShapeProblem(ruleWithWindowsCheck(registryItem({ registry: [REGISTRY_SETTING] })))).toBeNull()
  })

  it('accepts a registry check item in a by_version entry', () => {
    const item = { ...registryItem({ registry: [REGISTRY_SETTING] }), by_version: { '24H2': { registry: [REGISTRY_SETTING], result: null, additional_info: null } } }

    expect(ruleShapeProblem(ruleWithWindowsCheck(item))).toBeNull()
  })

  it.each([
    ['an empty settings list', registryItem({ registry: [] })],
    ['a registry item that also has shell', registryItem({ registry: [REGISTRY_SETTING], shell: 'echo hi' })],
    ['a registry item with a result', registryItem({ registry: [REGISTRY_SETTING], result: { type: 'integer', value: 1 } })],
    ['a registry item with no registry', registryItem({})],
    ['an unknown hive', registryItem({ registry: [{ ...REGISTRY_SETTING, hive: 'HKXX' }] })],
    ['an unknown registry type', registryItem({ registry: [{ ...REGISTRY_SETTING, type: 'REG_NONE' }] })],
    ['a DWORD above the maximum', registryItem({ registry: [{ ...REGISTRY_SETTING, data: 4294967296 }] })],
    ['a DWORD that is a string', registryItem({ registry: [{ ...REGISTRY_SETTING, data: '1' }] })],
    ['a registry setting with an extra key', registryItem({ registry: [{ ...REGISTRY_SETTING, extra: 1 }] })],
    ['an absent setting with data', registryItem({ registry: [{ ...REGISTRY_SETTING, state: 'absent' }] })],
    ['a path with a leading backslash', registryItem({ registry: [{ ...REGISTRY_SETTING, path: '\\SOFTWARE' }] })],
    ['an odd-length binary', registryItem({ registry: [{ ...REGISTRY_SETTING, type: 'REG_BINARY', data: 'abc' }] })],
    ['a multi-string that is a string', registryItem({ registry: [{ ...REGISTRY_SETTING, type: 'REG_MULTI_SZ', data: 'a' }] })],
  ])('rejects %s', (_name, item) => {
    expect(ruleShapeProblem(ruleWithWindowsCheck(item))).not.toBeNull()
  })

  it('accepts each registry type with matching data, a whole-value ODV and an absent setting', () => {
    const settings = [
      REGISTRY_SETTING,
      { ...REGISTRY_SETTING, type: 'REG_QWORD', data: Number.MAX_SAFE_INTEGER },
      { ...REGISTRY_SETTING, type: 'REG_SZ', data: 'text' },
      { ...REGISTRY_SETTING, type: 'REG_EXPAND_SZ', data: '%SystemRoot%' },
      { ...REGISTRY_SETTING, type: 'REG_MULTI_SZ', data: ['a', 'b'] },
      { ...REGISTRY_SETTING, type: 'REG_BINARY', data: '01ab' },
      { ...REGISTRY_SETTING, data: '$ODV_timeout' },
      { ...REGISTRY_SETTING, value_name: '', type: null, data: null, state: 'absent' },
    ]

    expect(ruleShapeProblem(ruleWithWindowsCheck(registryItem({ registry: settings })))).toBeNull()
  })

  it('rejects a registry body on a powershell check item', () => {
    const item = { name: null, language: 'powershell', default: { registry: [REGISTRY_SETTING], result: null, additional_info: null }, by_version: {} }

    expect(ruleShapeProblem(ruleWithWindowsCheck(item))).not.toBeNull()
  })

  it.each(['ansible', 'goss'])('accepts inline %s text and rejects a shell_file', (language) => {
    const inline = { name: null, language, default: { shell: 'text', result: null, additional_info: null }, by_version: {} }
    const fromFile = { name: null, language, default: { shell_file: 'baselines/x/check.ps1', result: null, additional_info: null }, by_version: {} }

    expect(ruleShapeProblem(ruleWithWindowsCheck(inline))).toBeNull()
    expect(ruleShapeProblem(ruleWithWindowsCheck(fromFile))).not.toBeNull()
  })

  it('applies the same body rules to remediation steps', () => {
    const rule = (step: Record<string, unknown>) => ({
      ...committedRule(),
      remediation: { Windows: { steps: [{ name: null, additional_info: null, versions: null, ...step }], payloads: [] } },
    })

    expect(ruleShapeProblem(rule({ language: 'registry', registry: [REGISTRY_SETTING] }))).toBeNull()
    expect(ruleShapeProblem(rule({ language: 'ansible', shell: '- name: x' }))).toBeNull()
    expect(ruleShapeProblem(rule({ language: 'goss', shell: 'file: {}' }))).toBeNull()
    expect(ruleShapeProblem(rule({ language: 'registry', registry: [REGISTRY_SETTING], shell: 'x' }))).not.toBeNull()
    expect(ruleShapeProblem(rule({ language: 'registry', registry: [] }))).not.toBeNull()
    expect(ruleShapeProblem(rule({ language: 'powershell', shell: 'x', registry: [REGISTRY_SETTING] }))).not.toBeNull()
    expect(ruleShapeProblem(rule({ language: 'ansible', shell_file: 'baselines/x/a.sh' }))).not.toBeNull()
  })
})
