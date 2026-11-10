// Shared by the tests only; nothing in the app imports it.
import { readFileSync } from 'node:fs'
import type { Manifest } from '../types/library'

const BASELINES_DIRECTORY = new URL('../../../baselines/', import.meta.url)

function currentSource(sourceName: string) {
  const manifest = JSON.parse(readFileSync(new URL('_manifest.json', BASELINES_DIRECTORY), 'utf8')) as Manifest
  const source = manifest.sources.find((candidate) => candidate.name === sourceName)
  if (source === undefined) throw new Error(`The manifest has no source ${sourceName}`)
  return source
}

// The release the app treats as current, so a re-import does not leave these tests reading an older one.
export function currentReleaseTag(sourceName: string): string {
  return currentSource(sourceName).release_tag
}

// The folder holding the current release's rule files, as a URL ending in a slash.
export function currentRulesDirectory(sourceName: string): URL {
  const indexPath = currentSource(sourceName).index_path
  return new URL(`${indexPath.slice(0, indexPath.lastIndexOf('/') + 1)}rules/`, BASELINES_DIRECTORY)
}
