import { applyOverlays, type OverlaidRule, type Overlay, type SkippedOverlay } from '../logic/overlays'
import type { RuleRef } from '../logic/selectionEntry'
import type { Rule } from '../types/library'
import type { RuleOverlaySource } from './overlays'

const importedCache = new Map<string, Promise<Rule>>()
type CachedOverlaidRule = OverlaidRule & { hadLoadFailure?: boolean }
const overlaidCache = new Map<string, Promise<CachedOverlaidRule>>()
const NO_OVERLAY_SOURCE: RuleOverlaySource = { overlayIdsFor: () => [], loadOverlay: () => Promise.reject(new Error('no overlay source')) }
let overlaySource: RuleOverlaySource = NO_OVERLAY_SOURCE

// Set once the library has loaded, before any rule is fetched. Every caller
// of fetchRule (details, generator, export) then gets the overlaid rule.
export function setRuleOverlays(source: RuleOverlaySource): void {
  overlaySource = source
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

// Fetches only the overlays that target this rule. With no startup dry run
// any more, an overlay that cannot be loaded or does not fit this rule is
// dropped for this rule alone, with a console warning and a line in the
// details (an accepted tradeoff: CI validates every overlay against every
// target before deploy).
async function loadOverlaidRule(ref: RuleRef): Promise<CachedOverlaidRule> {
  const rule = await fetchImportedRule(ref)
  const overlayIds = overlaySource.overlayIdsFor(ref.id)
  if (overlayIds.length === 0) return { rule, provenance: new Map(), applied: [], skipped: [] }

  const loadFailures: SkippedOverlay[] = []
  const loaded = await Promise.all(
    overlayIds.map((overlayId) =>
      overlaySource.loadOverlay(overlayId).catch((error: unknown) => {
        loadFailures.push({ overlayId, message: `${ref.id}: ${describeError(error)}` })
        return null
      }),
    ),
  )
  const overlays = loaded.filter((overlay): overlay is Overlay => overlay !== null)
  const overlaid = applyOverlays(rule, overlays, rule.source.release_tag)
  const skipped = [...loadFailures, ...overlaid.skipped]
  for (const entry of skipped) console.warn(`Custom content ${entry.overlayId} was skipped: ${entry.message}`)
  return { ...overlaid, skipped, hadLoadFailure: loadFailures.length > 0 }
}

// A merge misfit is deterministic and stays cached. A load failure may be a
// network blip, so a result that has one is evicted once it resolves and the
// next call fetches the overlay again.
export function fetchOverlaidRule(ref: RuleRef): Promise<OverlaidRule> {
  const pending = cached(overlaidCache, ref, loadOverlaidRule)
  // A rejection is already handled (and evicted) by cached().
  pending.then(
    (overlaid) => {
      if (overlaid.hadLoadFailure && overlaidCache.get(ref.id) === pending) overlaidCache.delete(ref.id)
    },
    () => {},
  )
  return pending
}

export function fetchRule(ref: RuleRef): Promise<Rule> {
  return fetchOverlaidRule(ref).then((overlaid) => overlaid.rule)
}
