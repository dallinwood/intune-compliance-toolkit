import type { RuleIndex } from '../types/rule'

const cache = new Map<string, Promise<RuleIndex>>()

export function fetchRuleIndex(indexPath: string): Promise<RuleIndex> {
  let entry = cache.get(indexPath)
  if (!entry) {
    entry = fetch(`${import.meta.env.BASE_URL}baselines/${indexPath}`).then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load rule index ${indexPath} (${response.status} ${response.statusText})`)
      }
      return response.json() as Promise<RuleIndex>
    })
    cache.set(indexPath, entry)
  }
  return entry
}
