import { benchmarksAt, parseVersionKey, scopeKeysOf, targetKeysOf } from '../logic/applicability'
import { GENERATED_TARGET } from '../logic/checkPlan'
import { linksWithinLibrary, type MappedRule, type MappingFileInfo } from '../logic/mappingIndex'
import { applyOverlaysToIndexEntry, type OnOverlaySkipped, type Overlay } from '../logic/overlays'
import { compareVersionsDescending } from '../logic/versions'
import type { ManifestRelease, ManifestSource, RuleIndex } from '../types/library'
import type { RuleRow } from '../types/rule-row'
import { fetchManifest } from './manifest'
import { fetchMappingIndex } from './mappings'
import { fetchOverlayIndex, ruleOverlaySourceFrom, startupOverlays } from './overlays'
import { setRuleOverlays } from './ruleDetail'
import { fetchRuleIndex } from './ruleIndex'

export interface Library {
  rows: RuleRow[]
  sources: ManifestSource[]
  coveredVersions: string[]
  overlayWarnings: string[]
  // Each rule's mapped rules, only where both rules are in this library.
  mappingsByRule: ReadonlyMap<string, MappedRule[]>
  mappingFiles: ReadonlyMap<string, MappingFileInfo>
  mappingWarnings: string[]
}

function directoryOf(path: string): string {
  const lastSlash = path.lastIndexOf('/')
  return lastSlash === -1 ? '' : path.slice(0, lastSlash)
}

// Overlays apply to the index entries first, so the table, filters, counts
// and search all see the overlaid values.
export function buildRuleRows(
  source: ManifestSource,
  index: RuleIndex,
  overlays: Overlay[] = [],
  onSkipped?: OnOverlaySkipped,
): RuleRow[] {
  const directory = directoryOf(source.index_path)
  return index.rules.map((importedEntry): RuleRow => {
    const entry = applyOverlaysToIndexEntry(importedEntry, overlays, onSkipped)
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

// Startup reads the overlay index only, never an overlay file or a targeted
// rule: the table applies each overlay's index-level fields, and an overlay
// that does not fit an entry is skipped for that rule with a warning. The
// full overlay is fetched and merged when the rule itself is opened.
export async function loadLibrary(): Promise<Library> {
  const [manifest, overlayIndex, mappingIndex] = await Promise.all([fetchManifest(), fetchOverlayIndex(), fetchMappingIndex()])
  const indexes = await Promise.all(manifest.sources.map((source) => fetchRuleIndex(source.index_path)))
  setRuleOverlays(ruleOverlaySourceFrom(overlayIndex))

  const warnings = [...overlayIndex.warnings]
  const onSkipped: OnOverlaySkipped = (skipped) => warnings.push(`Overlay ${skipped.overlayId}: ${skipped.message}. It was skipped.`)
  const overlays = startupOverlays(overlayIndex)
  const rows = manifest.sources.flatMap((source, position) => buildRuleRows(source, indexes[position], overlays, onSkipped))

  return {
    rows,
    sources: manifest.sources,
    coveredVersions: coveredVersionsOf(rows, GENERATED_TARGET),
    overlayWarnings: warnings,
    mappingsByRule: linksWithinLibrary(mappingIndex.byRule, new Set(rows.map((row) => row.ref.id))),
    mappingFiles: mappingIndex.mappingFiles,
    mappingWarnings: mappingIndex.warnings,
  }
}

const releaseRowsCache = new Map<string, Promise<RuleRow[]>>()

// An older release's rows, built like the current release's: from its own
// index, with the same index-level overlays. Overlays are written against
// the current release, so one that does not fit an older rule is skipped
// without a warning; the startup warnings already cover the current release.
// Cached per release for the session; a failure is not cached, so choosing
// the release again retries.
export function loadReleaseRows(source: ManifestSource, release: ManifestRelease): Promise<RuleRow[]> {
  const cached = releaseRowsCache.get(release.index_path)
  if (cached) return cached
  const releaseSource: ManifestSource = { ...source, release_tag: release.tag, index_path: release.index_path }
  const pending = Promise.all([fetchRuleIndex(release.index_path), fetchOverlayIndex()]).then(([index, overlayIndex]) =>
    buildRuleRows(releaseSource, index, startupOverlays(overlayIndex)),
  )
  releaseRowsCache.set(release.index_path, pending)
  pending.catch(() => {
    if (releaseRowsCache.get(release.index_path) === pending) releaseRowsCache.delete(release.index_path)
  })
  return pending
}
