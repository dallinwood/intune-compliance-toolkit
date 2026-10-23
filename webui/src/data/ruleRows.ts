import { benchmarksAt, parseVersionKey, scopeKeysOf, targetKeysOf } from '../logic/applicability'
import { GENERATED_TARGET } from '../logic/checkPlan'
import { applyOverlaysToIndexEntry, type Overlay } from '../logic/overlays'
import { compareVersionsDescending } from '../logic/versions'
import type { IndexEntry, ManifestSource, RuleIndex } from '../types/library'
import type { RuleRow } from '../types/rule-row'
import { fetchManifest } from './manifest'
import { fetchOverlays, overlaysFittingIndex } from './overlays'
import { setRuleOverlays } from './ruleDetail'
import { fetchRuleIndex } from './ruleIndex'

export interface Library {
  rows: RuleRow[]
  sources: ManifestSource[]
  coveredVersions: string[]
  overlayWarnings: string[]
}

function directoryOf(path: string): string {
  const lastSlash = path.lastIndexOf('/')
  return lastSlash === -1 ? '' : path.slice(0, lastSlash)
}

// Overlays apply to the index entries first, so the table, filters, counts
// and search all see the overlaid values.
export function buildRuleRows(source: ManifestSource, index: RuleIndex, overlays: Overlay[] = []): RuleRow[] {
  const directory = directoryOf(source.index_path)
  return index.rules.map((importedEntry): RuleRow => {
    const entry = applyOverlaysToIndexEntry(importedEntry, overlays)
    const scopeKeys = scopeKeysOf(entry.applicability)
    const benchmarks = new Set<string>()
    for (const key of scopeKeys) {
      for (const benchmark of benchmarksAt(entry.applicability, key)) benchmarks.add(benchmark.name)
    }
    return {
      ref: { id: entry.id, path: directory ? `${directory}/${entry.file}` : entry.file },
      title: entry.title,
      targetKeys: targetKeysOf(entry.applicability),
      section: entry.section,
      // A browser holding an index cached from before section_path existed
      // still gets a one-level path.
      sectionPath: entry.section_path ?? [entry.section],
      sourceName: source.name,
      releaseTag: source.release_tag,
      assessment: entry.assessment,
      architecture: entry.architecture,
      applicability: entry.applicability,
      scopeKeys,
      benchmarks: Array.from(benchmarks).sort(),
      tags: entry.tags,
      hasOdv: entry.has_odv,
    }
  })
}

export function coveredVersionsOf(rows: RuleRow[], target: string): string[] {
  const versions = new Set<string>()
  for (const row of rows) {
    for (const key of row.scopeKeys) {
      const parsedKey = parseVersionKey(key)
      if (parsedKey.target === target) versions.add(parsedKey.version)
    }
  }
  return Array.from(versions).sort(compareVersionsDescending)
}

export async function loadLibrary(): Promise<Library> {
  const [manifest, loadedOverlays] = await Promise.all([fetchManifest(), fetchOverlays()])
  const indexes = await Promise.all(manifest.sources.map((source) => fetchRuleIndex(source.index_path)))

  const entriesById = new Map<string, IndexEntry>()
  for (const index of indexes) for (const entry of index.rules) entriesById.set(entry.id, entry)
  const { overlays, warnings } = overlaysFittingIndex(loadedOverlays, entriesById)
  setRuleOverlays(overlays)

  const rows = manifest.sources.flatMap((source, position) => buildRuleRows(source, indexes[position], overlays))

  return {
    rows,
    sources: manifest.sources,
    coveredVersions: coveredVersionsOf(rows, GENERATED_TARGET),
    overlayWarnings: warnings,
  }
}
