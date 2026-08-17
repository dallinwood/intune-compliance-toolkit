import type { RuleRef } from '../logic/selectionEntry'
import type { RuleDetail } from '../types/rule-detail'

const cache = new Map<string, Promise<RuleDetail>>()

function rulePath(ref: RuleRef): string {
  return `${ref.family}/${ref.product}/${ref.version}/${ref.file}`
}

export function fetchRuleDetail(ref: RuleRef): Promise<RuleDetail> {
  const path = rulePath(ref)
  let entry = cache.get(path)
  if (!entry) {
    entry = fetch(`${import.meta.env.BASE_URL}baselines/${path}`).then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load rule ${path} (${response.status} ${response.statusText})`)
      }
      return response.json() as Promise<RuleDetail>
    })
    cache.set(path, entry)
  }
  return entry
}
