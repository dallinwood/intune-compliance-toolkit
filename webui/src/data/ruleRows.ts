import { compareVersionsDescending } from '../logic/benchmarkLabels'
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
    const osVersions = Object.keys(entry.applicability).sort(compareVersionsDescending)
    const benchmarks = new Set<string>()
    for (const version of osVersions) {
      for (const benchmark of entry.applicability[version]) benchmarks.add(benchmark.name)
    }
    return {
      ref: { id: entry.id, path: directory ? `${directory}/${entry.file}` : entry.file },
      title: entry.title,
      section: entry.section,
      sourceName: source.name,
      releaseTag: source.release_tag,
      assessment: entry.assessment,
      architecture: entry.architecture,
      applicability: entry.applicability,
      osVersions,
      benchmarks: Array.from(benchmarks).sort(),
      tags: entry.tags,
      hasOdv: entry.has_odv,
    }
  })
}

export function coveredVersionsOf(rows: RuleRow[]): string[] {
  const versions = new Set<string>()
  for (const row of rows) row.osVersions.forEach((version) => versions.add(version))
  return Array.from(versions).sort(compareVersionsDescending)
}

export async function loadLibrary(): Promise<Library> {
  const manifest = await fetchManifest()

  const rowsBySource = await Promise.all(
    manifest.sources.map(async (source) => buildRuleRows(source, await fetchRuleIndex(source.index_path))),
  )
  const rows = rowsBySource.flat()

  return { rows, sources: manifest.sources, coveredVersions: coveredVersionsOf(rows) }
}
