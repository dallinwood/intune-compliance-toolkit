import { describe, expect, it } from 'vitest'
import { buildBundleFiles, serializeRulesJson } from './bundleFiles'
import { classifyRule, packChunks, type Chunk, type GeneratableRule } from './chunking'
import { createSelectionEntry } from './selectionEntry'
import { inlineRule, type InlineRuleOptions } from './testRuleFixtures'
import { committedVocabularyIndex } from './testVocabularyFixtures'

const vocabularyIndex = committedVocabularyIndex()

function generatable(options: InlineRuleOptions): GeneratableRule {
  const rule = inlineRule(options)
  const selection = { ...createSelectionEntry({ id: rule.id, path: 'unused' }), enabled: true }
  const result = classifyRule(rule, selection, ['27.0', '26.0', '15.0'], vocabularyIndex)
  if (result.kind !== 'generatable') throw new Error(`Expected generatable, got ${result.kind}`)
  return result.rule
}

function numbered(count: number, section: string, releaseTag = 'release_27.0'): GeneratableRule[] {
  return Array.from({ length: count }, (_, index) => generatable({ upstreamId: `${section}_rule_${index + 1}`, section, releaseTag }))
}

describe('buildBundleFiles', () => {
  it('names an unsplit section macOS-<source>-<release>-<section> with a discovery script and rules JSON', () => {
    const files = buildBundleFiles(packChunks(numbered(2, 'auth'), vocabularyIndex), [])
    const paths = files.map((file) => file.path)

    expect(paths).toEqual([
      'macOS-mscp-release_27.0-auth-discovery.sh',
      'macOS-mscp-release_27.0-auth-rules.json',
      'manual-attestation.md',
    ])

    const script = files[0].content
    expect(script.startsWith('#!/bin/bash\n')).toBe(true)
    expect(script).toContain('"auth_rule_1":%s')

    expect(files[1].content).toBe(serializeRulesJson(packChunks(numbered(2, 'auth'), vocabularyIndex)[0].ruleEntries))
    const rulesJson = JSON.parse(files[1].content)
    expect(rulesJson.Rules.map((entry: { SettingName: string }) => entry.SettingName)).toEqual(['auth_rule_1', 'auth_rule_2'])
  })

  it('adds -part<N> only when a section splits into several chunks', () => {
    const paths = buildBundleFiles(packChunks(numbered(3, 'os'), vocabularyIndex, { maxRulesPerChunk: 2 }), []).map((file) => file.path)

    expect(paths).toEqual([
      'macOS-mscp-release_27.0-os-part1-discovery.sh',
      'macOS-mscp-release_27.0-os-part1-rules.json',
      'macOS-mscp-release_27.0-os-part2-discovery.sh',
      'macOS-mscp-release_27.0-os-part2-rules.json',
      'manual-attestation.md',
    ])
  })

  it('gives every chunk distinct file names across sections, parts and release tags', () => {
    const rules = [
      ...numbered(5, 'os'),
      ...numbered(5, 'os', 'release_26.0'),
      ...numbered(3, 'auth'),
      ...numbered(4, 'system_settings'),
    ]
    const paths = buildBundleFiles(packChunks(rules, vocabularyIndex, { maxRulesPerChunk: 2 }), []).map((file) => file.path)

    expect(new Set(paths).size).toBe(paths.length)
    expect(paths).toHaveLength(2 * (3 + 3 + 2 + 2) + 1)
  })

  it('always includes manual-attestation.md, even with no chunks', () => {
    expect(buildBundleFiles([], []).map((file) => file.path)).toEqual(['manual-attestation.md'])
  })

  it('throws rather than overwrite a file when two chunks would produce the same name', () => {
    const [chunk] = packChunks(numbered(1, 'os'), vocabularyIndex)
    const duplicate: Chunk = { ...chunk }

    expect(() => buildBundleFiles([chunk, duplicate], [])).toThrow(/same name/)
  })
})
