import type { RuleRef } from '../logic/selectionEntry'
import type { Rule } from '../types/library'

const cache = new Map<string, Promise<Rule>>()

export function fetchRule(ref: RuleRef): Promise<Rule> {
  let entry = cache.get(ref.id)
  if (!entry) {
    entry = fetch(`${import.meta.env.BASE_URL}baselines/${ref.path}`).then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load rule ${ref.id} (${response.status} ${response.statusText})`)
      }
      return response.json() as Promise<Rule>
    })
    cache.set(ref.id, entry)
  }
  return entry
}
