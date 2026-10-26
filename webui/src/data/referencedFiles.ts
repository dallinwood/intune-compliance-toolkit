import { publishedFileUrl } from '../logic/fileReferences'

const textCache = new Map<string, Promise<string>>()

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function loadText(path: string): Promise<string> {
  const failure = (detail: string) => new Error(`Could not load ${path}${detail}`)
  const url = publishedFileUrl(path, import.meta.env.BASE_URL, window.location.origin)
  if (url === null) throw failure(': the path is outside the published baselines/ folder')
  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    throw failure(`: ${describeError(error)}`)
  }
  if (!response.ok) throw failure(` (${response.status} ${response.statusText})`)
  // A static host's fallback page (Vite dev serves index.html with a 200 for
  // a missing file) must not be shown as the script.
  const contentType = response.headers.get('Content-Type') ?? ''
  if (contentType.toLowerCase().includes('text/html')) throw failure(': the file is missing from the published site')
  return response.text()
}

// The text of a file a rule references (shell_file or a text data_file), from
// the published copy of baselines/. A failure is not cached, so a later call
// fetches again.
export function fetchReferencedText(path: string): Promise<string> {
  const existing = textCache.get(path)
  if (existing) return existing
  const pending = loadText(path)
  textCache.set(path, pending)
  pending.catch(() => {
    if (textCache.get(path) === pending) textCache.delete(path)
  })
  return pending
}
