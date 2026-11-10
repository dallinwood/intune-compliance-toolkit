import { parseHistoryIndex, type HistoryIndex } from '../logic/historyIndex'
import type { Rule } from '../types/library'
import { fetchJson } from './fetchJson'

const historyCache = new Map<string, Promise<HistoryIndex>>()
const ruleCache = new Map<string, Promise<Rule>>()

async function loadHistoryIndex(sourceName: string): Promise<HistoryIndex> {
  const path = `baselines/_history/${sourceName}.json`
  const file = await fetchJson(path)
  if ('problem' in file) throw new Error(`Failed to load the release history of ${sourceName} (${path}: ${file.problem})`)
  const parsed = parseHistoryIndex(file.value)
  if ('error' in parsed) throw new Error(`The release history of ${sourceName} is unusable (${path}: ${parsed.error})`)
  return parsed
}

// A failure is not cached, so a later call retries instead of replaying it.
function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let entry = cache.get(key)
  if (!entry) {
    entry = load()
    cache.set(key, entry)
    entry.catch(() => cache.delete(key))
  }
  return entry
}

export function fetchHistoryIndex(sourceName: string): Promise<HistoryIndex> {
  return cached(historyCache, sourceName, () => loadHistoryIndex(sourceName))
}

// The imported rule exactly as that release stored it (no custom changes).
export function fetchRuleAtRelease(index: HistoryIndex, ruleId: string, tag: string): Promise<Rule> {
  const release = index.releases.find((candidate) => candidate.tag === tag)
  if (release === undefined) return Promise.reject(new Error(`Release ${tag} is not in the history of ${index.source}`))
  const entry = index.rules[ruleId]
  if (entry === undefined) return Promise.reject(new Error(`Rule ${ruleId} is not in the history of ${index.source}`))
  const releaseDirectory = release.index_path.slice(0, release.index_path.lastIndexOf('/') + 1)
  const path = `baselines/${releaseDirectory}${entry.file}`
  return cached(ruleCache, path, async () => {
    const file = await fetchJson(path)
    if ('problem' in file) throw new Error(`Failed to load rule ${ruleId} at ${release.label} (${file.problem})`)
    return file.value as Rule
  })
}
