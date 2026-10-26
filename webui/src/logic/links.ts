export type LinkSegment = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string }

// Only http(s) URLs are ever links. A URL stops at whitespace and at the
// brackets that usually wrap it, and drops trailing sentence punctuation
// and quotes so "see https://example.com/a." links without the full stop.
export const BARE_URL_PATTERN_SOURCE = String.raw`https?:\/\/[^\s<>()\[\]]*[^\s<>()\[\].,;:!?'"]`

export function linkSegments(text: string): LinkSegment[] {
  const segments: LinkSegment[] = []
  let consumedUpTo = 0

  for (const match of text.matchAll(new RegExp(BARE_URL_PATTERN_SOURCE, 'g'))) {
    if (match.index > consumedUpTo) segments.push({ kind: 'text', text: text.slice(consumedUpTo, match.index) })
    segments.push({ kind: 'link', text: match[0], href: match[0] })
    consumedUpTo = match.index + match[0].length
  }

  if (consumedUpTo < text.length) segments.push({ kind: 'text', text: text.slice(consumedUpTo) })
  return segments
}
