import type { RuleRef } from '../logic/selectionEntry'
import type { Rule } from '../types/library'

const cache = new Map<string, Promise<Rule>>()

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function loadRule(ref: RuleRef): Promise<Rule> {
  const failure = (detail: string) => new Error(`Failed to load rule ${ref.id}${detail}`)

  let response: Response
  try {
    response = await fetch(`${import.meta.env.BASE_URL}baselines/${ref.path}`)
  } catch (error) {
    throw failure(`: ${describeError(error)}`)
  }
  if (!response.ok) throw failure(` (${response.status} ${response.statusText})`)

  // A static host's fallback page (Vite dev serves index.html with a 200 for
  // a missing file) would otherwise surface as a confusing JSON parse error.
  const contentType = response.headers.get('Content-Type') ?? ''
  if (contentType !== '' && !contentType.toLowerCase().includes('json')) {
    throw failure(`: expected JSON but got ${contentType}`)
  }

  try {
    return (await response.json()) as Rule
  } catch (error) {
    throw failure(`: the response is not valid JSON (${describeError(error)})`)
  }
}

export function fetchRule(ref: RuleRef): Promise<Rule> {
  const cached = cache.get(ref.id)
  if (cached) return cached

  const pending = loadRule(ref)
  cache.set(ref.id, pending)
  // A failure is not cached, so a later call (e.g. after a network blip)
  // fetches again instead of replaying the same rejection forever.
  pending.catch(() => {
    if (cache.get(ref.id) === pending) cache.delete(ref.id)
  })
  return pending
}
