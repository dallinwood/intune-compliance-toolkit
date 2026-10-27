import { indexLevelOverlays, parseOverlayIndex, type IndexedOverlay } from '../logic/overlayIndex'
import { parseOverlay, type Overlay } from '../logic/overlays'
import { describeError, fetchJson } from './fetchJson'

const OVERLAYS_DIRECTORY = 'baselines/_overlays/'
const INDEX_PATH = `${OVERLAYS_DIRECTORY}_index.json`

export interface LoadedOverlayIndex {
  overlays: IndexedOverlay[]
  byRule: ReadonlyMap<string, string[]>
  warnings: string[]
}

function noOverlays(warning: string): LoadedOverlayIndex {
  return { overlays: [], byRule: new Map(), warnings: [warning] }
}

async function loadOverlayIndex(): Promise<LoadedOverlayIndex> {
  const file = await fetchJson(INDEX_PATH)
  if ('problem' in file) {
    return noOverlays(`Custom content could not be loaded (${INDEX_PATH}: ${file.problem}), so rules are shown as imported.`)
  }
  const parsed = parseOverlayIndex(file.value)
  if (typeof parsed === 'string') {
    return noOverlays(`Custom content could not be loaded (${INDEX_PATH}: ${parsed}), so rules are shown as imported.`)
  }
  return parsed
}

let cachedIndex: Promise<LoadedOverlayIndex> | null = null

// Cached per session and never rejects: custom content is an addition, so
// any failure leaves the imported rules usable with a warning. Only this
// index is fetched at startup; an overlay's own file waits until a rule it
// targets is opened.
export function fetchOverlayIndex(): Promise<LoadedOverlayIndex> {
  if (!cachedIndex) {
    cachedIndex = loadOverlayIndex().catch((error: unknown) =>
      noOverlays(`Custom content could not be loaded (${describeError(error)}), so rules are shown as imported.`),
    )
  }
  return cachedIndex
}

// What the table, filters and search apply at startup: each overlay's
// index-level fields.
export function startupOverlays(loaded: LoadedOverlayIndex): Overlay[] {
  return indexLevelOverlays(loaded.overlays)
}

export interface RuleOverlaySource {
  overlayIdsFor: (ruleId: string) => string[]
  loadOverlay: (overlayId: string) => Promise<Overlay>
}

// Loads and caches each overlay file on first use. A failure is not cached,
// so a later open retries instead of replaying it.
export function ruleOverlaySourceFrom(loaded: LoadedOverlayIndex): RuleOverlaySource {
  const entryById = new Map(loaded.overlays.map((overlay) => [overlay.id, overlay]))
  const fileCache = new Map<string, Promise<Overlay>>()

  async function loadFile(entry: IndexedOverlay): Promise<Overlay> {
    const file = await fetchJson(`${OVERLAYS_DIRECTORY}${entry.file}`)
    if ('problem' in file) throw new Error(`${entry.file}: ${file.problem}`)
    const parsed = parseOverlay(file.value, entry.file)
    if ('error' in parsed) throw new Error(parsed.error)
    if (parsed.overlay.id !== entry.id) throw new Error(`${entry.file}: id ${parsed.overlay.id} does not match the index (${entry.id})`)
    return parsed.overlay
  }

  return {
    overlayIdsFor: (ruleId) => loaded.byRule.get(ruleId) ?? [],
    loadOverlay: (overlayId) => {
      const existing = fileCache.get(overlayId)
      if (existing) return existing
      const entry = entryById.get(overlayId)
      if (!entry) return Promise.reject(new Error(`${overlayId}: not in the overlay index`))
      const pending = loadFile(entry)
      fileCache.set(overlayId, pending)
      pending.catch(() => {
        if (fileCache.get(overlayId) === pending) fileCache.delete(overlayId)
      })
      return pending
    },
  }
}
