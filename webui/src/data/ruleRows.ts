import { benchmarksAt, parseVersionKey, targetsOf, versionKeysOf } from '../logic/applicability'
import { GENERATED_TARGET } from '../logic/checkPlan'
import { compareVersionsDescending } from '../logic/versions'
import type { ManifestSource, RuleIndex } from '../types/library'
import type { RuleRow } from '../types/rule-row'
import { fetchManifest } from './manifest'
import { fetchRuleIndex } from './ruleIndex'

export interface Library {
  rows: RuleRow[]
  sources: ManifestSource[]
  coveredVersions: string[]
}

function directoryOf(path: string): string {
  const lastSlash = path.lastIndexOf('/')
  return lastSlash === -1 ? '' : path.slice(0, lastSlash)
}

export function buildRuleRows(source: ManifestSource, index: RuleIndex): RuleRow[] {
  const directory = directoryOf(source.index_path)
  return index.rules.map((entry): RuleRow => {
    const versionKeys = versionKeysOf(entry.applicability)
    const benchmarks = new Set<string>()
    for (const key of versionKeys) {
      for (const benchmark of benchmarksAt(entry.applicability, key)) benchmarks.add(benchmark.name)
    }
    return {
      ref: { id: entry.id, path: directory ? `${directory}/${entry.file}` : entry.file },
      title: entry.title,
      targets: targetsOf(entry.applicability),
      section: entry.section,
      sourceName: source.name,
      releaseTag: source.release_tag,
      assessment: entry.assessment,
      architecture: entry.architecture,
      applicability: entry.applicability,
      versionKeys,
      benchmarks: Array.from(benchmarks).sort(),
      tags: entry.tags,
      hasOdv: entry.has_odv,
    }
  })
}

export function coveredVersionsOf(rows: RuleRow[], target: string): string[] {
  const versions = new Set<string>()
  for (const row of rows) {
    for (const key of row.versionKeys) {
      const parsedKey = parseVersionKey(key)
      if (parsedKey.target === target) versions.add(parsedKey.version)
    }
  }
  return Array.from(versions).sort(compareVersionsDescending)
}

export async function loadLibrary(): Promise<Library> {
  const manifest = await fetchManifest()

  const rowsBySource = await Promise.all(
    manifest.sources.map(async (source) => buildRuleRows(source, await fetchRuleIndex(source.index_path))),
  )
  const rows = rowsBySource.flat()

  return { rows, sources: manifest.sources, coveredVersions: coveredVersionsOf(rows, GENERATED_TARGET) }
}
