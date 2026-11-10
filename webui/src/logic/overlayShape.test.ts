import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Manifest, RuleIndex } from '../types/library'
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
