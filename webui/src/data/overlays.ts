import { applyOverlayToCheckedIndexEntry, applyOverlayToRule, parseOverlay, type Overlay } from '../logic/overlays'
import type { IndexEntry, Rule } from '../types/library'

const OVERLAYS_DIRECTORY = 'overlays/'
const MANIFEST_PATH = `${OVERLAYS_DIRECTORY}_manifest.json`

export interface LoadedOverlays {
  overlays: Overlay[]
  warnings: string[]
  fileNameById: ReadonlyMap<string, string>
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

function noOverlays(warning: string): LoadedOverlays {
  return { overlays: [], warnings: [warning], fileNameById: new Map() }
}

async function loadOverlays(): Promise<LoadedOverlays> {
  const manifest = await fetchJson(MANIFEST_PATH)
  if ('problem' in manifest) {
    return noOverlays(`Custom content could not be loaded (${MANIFEST_PATH}: ${manifest.problem}), so rules are shown as imported.`)
  }
  const fileNames = manifestFiles(manifest.value)
  if (fileNames === null) {
    return noOverlays(`Custom content could not be loaded (${MANIFEST_PATH} has no list of files), so rules are shown as imported.`)
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
  return { overlays, warnings, fileNameById }
}

let cachedOverlays: Promise<LoadedOverlays> | null = null

// Cached per session and never rejects: custom content is an addition, so
// any failure leaves the imported rules usable with a warning.
export function fetchOverlays(): Promise<LoadedOverlays> {
  if (!cachedOverlays) {
    cachedOverlays = loadOverlays().catch((error: unknown) =>
      noOverlays(`Custom content could not be loaded (${describeError(error)}), so rules are shown as imported.`),
    )
  }
  return cachedOverlays
}

export interface LibraryTarget {
  entry: IndexEntry
  // Null when the rule file could not be fetched at load.
  rule: Rule | null
  // Builds the table row for an entry, so anything that would throw there
  // is found before the real rows are built.
  buildRow: (entry: IndexEntry) => void
}

function describeProblem(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Dry-runs the overlays in manifest order, the order rows and rules use,
// against the index entries and the full rules they target. An overlay that
// fails for any target is dropped for every target, with one warning naming
// its file and the rule; the overlays before it stay applied. A target
// missing from the library is ignored for that target alone.
export function overlaysFittingLibrary(loaded: LoadedOverlays, targets: ReadonlyMap<string, LibraryTarget>): LoadedOverlays {
  const overlays: Overlay[] = []
  const warnings = [...loaded.warnings]
  const currentEntries = new Map<string, IndexEntry>()
  const currentRules = new Map<string, Rule>()

  for (const overlay of loaded.overlays) {
    const nextEntries = new Map<string, IndexEntry>()
    const nextRules = new Map<string, Rule>()
    let problem: string | null = null
    for (const ruleId of new Set(overlay.targets.map((target) => target.rule))) {
      const target = targets.get(ruleId)
      if (!target) continue
      try {
        const entry = applyOverlayToCheckedIndexEntry(currentEntries.get(ruleId) ?? target.entry, overlay.fields)
        target.buildRow(entry)
        nextEntries.set(ruleId, entry)
        const rule = currentRules.get(ruleId) ?? target.rule
        if (rule) nextRules.set(ruleId, applyOverlayToRule(rule, overlay.fields))
      } catch (error) {
        problem = `${ruleId}: ${describeProblem(error)}`
        break
      }
    }
    if (problem !== null) {
      const fileName = loaded.fileNameById.get(overlay.id) ?? overlay.id
      warnings.push(`${fileName}: ${problem}. It was skipped.`)
      continue
    }
    for (const [ruleId, entry] of nextEntries) currentEntries.set(ruleId, entry)
    for (const [ruleId, rule] of nextRules) currentRules.set(ruleId, rule)
    overlays.push(overlay)
  }
  return { overlays, warnings, fileNameById: loaded.fileNameById }
}
