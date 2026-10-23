import { applyOverlays, type OverlaidRule, type Overlay } from '../logic/overlays'
import type { RuleRef } from '../logic/selectionEntry'
import type { Rule } from '../types/library'

const importedCache = new Map<string, Promise<Rule>>()
const overlaidCache = new Map<string, Promise<OverlaidRule>>()
let ruleOverlays: Overlay[] = []

// Set once the library has loaded, before any rule is fetched. Every caller
// of fetchRule (details, generator, export) then gets the overlaid rule.
export function setRuleOverlays(overlays: Overlay[]): void {
  ruleOverlays = overlays
  overlaidCache.clear()
}

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

// A failure is not cached, so a later call (e.g. after a network blip)
// fetches again instead of replaying the same rejection forever.
function cached<T>(cache: Map<string, Promise<T>>, ref: RuleRef, load: (ref: RuleRef) => Promise<T>): Promise<T> {
  const existing = cache.get(ref.id)
  if (existing) return existing

  const pending = load(ref)
  cache.set(ref.id, pending)
  pending.catch(() => {
    if (cache.get(ref.id) === pending) cache.delete(ref.id)
  })
  return pending
}

// The rule exactly as imported: the load-time overlay checks and the details'
// fallback when overlaid content cannot be shown.
export function fetchImportedRule(ref: RuleRef): Promise<Rule> {
  return cached(importedCache, ref, loadRule)
}

async function loadOverlaidRule(ref: RuleRef): Promise<OverlaidRule> {
  const rule = await fetchImportedRule(ref)
  const isTargeted = ruleOverlays.some((overlay) => overlay.targets.some((target) => target.rule === ref.id))
  if (!isTargeted) return { rule, provenance: new Map(), applied: [], skipped: [] }
  const overlaid = applyOverlays(rule, ruleOverlays, rule.source.release_tag)
  // The load-time dry run drops misfits, so this only fires if the rule file
  // changed or could not be checked then.
  for (const skipped of overlaid.skipped) console.warn(`Custom content ${skipped.overlayId} was skipped: ${skipped.message}`)
  return overlaid
}

export function fetchOverlaidRule(ref: RuleRef): Promise<OverlaidRule> {
  return cached(overlaidCache, ref, loadOverlaidRule)
}

export function fetchRule(ref: RuleRef): Promise<Rule> {
  return fetchOverlaidRule(ref).then((overlaid) => overlaid.rule)
}
