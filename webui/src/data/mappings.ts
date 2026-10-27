import { parseMappingIndex, type MappedRule } from '../logic/mappingIndex'
import { describeError, fetchJson } from './fetchJson'

const INDEX_PATH = 'baselines/_mappings/_index.json'

export interface LoadedMappingIndex {
  byRule: ReadonlyMap<string, MappedRule[]>
  warnings: string[]
}

function noMappings(problem: string): LoadedMappingIndex {
  return { byRule: new Map(), warnings: [`Rule mappings could not be loaded (${INDEX_PATH}: ${problem}), so no mapped rules are shown.`] }
}

async function loadMappingIndex(): Promise<LoadedMappingIndex> {
  const file = await fetchJson(INDEX_PATH)
  if ('problem' in file) return noMappings(file.problem)
  const parsed = parseMappingIndex(file.value)
  if (typeof parsed === 'string') return noMappings(parsed)
  return parsed
}

let cachedIndex: Promise<LoadedMappingIndex> | null = null

// Cached per session and never rejects: mappings are an addition, so any
// failure leaves the library usable with a warning.
export function fetchMappingIndex(): Promise<LoadedMappingIndex> {
  if (!cachedIndex) cachedIndex = loadMappingIndex().catch((error: unknown) => noMappings(describeError(error)))
  return cachedIndex
}
