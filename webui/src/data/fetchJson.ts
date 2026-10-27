export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// A dev server answers a missing file with its HTML fallback page and a 200,
// so the content type and the parse are checked as well as the status.
export async function fetchJson(path: string): Promise<{ value: unknown } | { problem: string }> {
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
