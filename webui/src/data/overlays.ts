import { applyOverlayToIndexEntry, InvalidOverlayError, parseOverlay, type Overlay } from '../logic/overlays'
import type { IndexEntry } from '../types/library'

const OVERLAYS_DIRECTORY = 'overlays/'
const MANIFEST_PATH = `${OVERLAYS_DIRECTORY}_manifest.json`

export interface LoadedOverlays {
  overlays: Overlay[]
  warnings: string[]
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// A dev server answers a missing file with its HTML fallback page and a 200,
// so the content type and the parse are checked as well as the status.
async function fetchJson(path: string): Promise<{ value: unknown } | { problem: string }> {
  let response: Response
  try {
    response = await fetch(`${import.meta.env.BASE_URL}${path}`)
  } catch (error) {
    return { problem: describeError(error) }
  }
  if (!response.ok) return { problem: `${response.status} ${response.statusText}`.trim() }
  const contentType = response.headers.get('Content-Type') ?? ''
  if (contentType !== '' && !contentType.toLowerCase().includes('json')) return { problem: `expected JSON but got ${contentType}` }
  try {
    return { value: await response.json() }
  } catch {
    return { problem: 'not valid JSON' }
  }
}

function manifestFiles(value: unknown): string[] | null {
  if (typeof value !== 'object' || value === null || !('files' in value)) return null
  const { files } = value as { files: unknown }
  return Array.isArray(files) && files.every((file) => typeof file === 'string') ? files : null
}

async function loadOverlays(): Promise<LoadedOverlays> {
  const manifest = await fetchJson(MANIFEST_PATH)
  if ('problem' in manifest) {
    return { overlays: [], warnings: [`Custom content could not be loaded (${MANIFEST_PATH}: ${manifest.problem}), so rules are shown as imported.`] }
  }
  const fileNames = manifestFiles(manifest.value)
  if (fileNames === null) {
    return { overlays: [], warnings: [`Custom content could not be loaded (${MANIFEST_PATH} has no list of files), so rules are shown as imported.`] }
  }

  const loaded = await Promise.all(
    fileNames.map(async (fileName) => {
      const file = await fetchJson(`${OVERLAYS_DIRECTORY}${fileName}`)
      return 'problem' in file ? { error: `${fileName}: ${file.problem}` } : parseOverlay(file.value, fileName)
    }),
  )

  const overlays: Overlay[] = []
  const warnings: string[] = []
  const fileNameById = new Map<string, string>()
  loaded.forEach((result, position) => {
    const fileName = fileNames[position]
    if ('error' in result) {
      warnings.push(`${result.error}. It was skipped.`)
      return
    }
    const earlierFile = fileNameById.get(result.overlay.id)
    if (earlierFile !== undefined) {
      warnings.push(`${fileName}: id ${result.overlay.id} is already used by ${earlierFile}. It was skipped.`)
      return
    }
    fileNameById.set(result.overlay.id, fileName)
    overlays.push(result.overlay)
  })
  return { overlays, warnings }
}

let cachedOverlays: Promise<LoadedOverlays> | null = null

// Cached per session and never rejects: custom content is an addition, so
// any failure leaves the imported rules usable with a warning.
export function fetchOverlays(): Promise<LoadedOverlays> {
  if (!cachedOverlays) {
    cachedOverlays = loadOverlays().catch((error: unknown) => ({
      overlays: [],
      warnings: [`Custom content could not be loaded (${describeError(error)}), so rules are shown as imported.`],
    }))
  }
  return cachedOverlays
}

// Applies each overlay to the index entries it targets, the earliest point
// a type mismatch can show. One that does not fit is skipped entirely, for
// every rule, rather than applied to some targets only. A target missing
// from the library is ignored for that target alone.
export function overlaysFittingIndex(
  loaded: LoadedOverlays,
  entriesById: ReadonlyMap<string, IndexEntry>,
): LoadedOverlays {
  const overlays: Overlay[] = []
  const warnings = [...loaded.warnings]
  for (const overlay of loaded.overlays) {
    let problem: string | null = null
    for (const target of overlay.targets) {
      const entry = entriesById.get(target.rule)
      if (!entry) continue
      try {
        applyOverlayToIndexEntry(entry, overlay.fields)
      } catch (error) {
        if (!(error instanceof InvalidOverlayError)) throw error
        problem = `${target.rule}: ${error.message}`
        break
      }
    }
    if (problem === null) overlays.push(overlay)
    else warnings.push(`Overlay ${overlay.id}: ${problem}. It was skipped.`)
  }
  return { overlays, warnings }
}
