// A deliberately small reading of the AsciiDoc mSCP uses in rule
// discussions: enough to show paragraphs, code and emphasis legibly, not a
// full AsciiDoc renderer. Anything unrecognised is shown as plain text.
// ASD ISM discussions are Markdown, but only `- ` lists and [text](url)
// links appear in them, so that is all the Markdown reader understands.

export type DiscussionFormat = 'asciidoc' | 'markdown'

export type DiscussionBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'list'; items: string[] }

export type InlineSegment =
  | { kind: 'text'; text: string }
  | { kind: 'emphasis'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }

const SOURCE_ATTRIBUTE_PATTERN = /^\[source(,[^\]]*)?\]$/
const ADMONITION_PATTERN = /^\[(NOTE|IMPORTANT|WARNING|TIP|CAUTION)\]$/
const IGNORED_ATTRIBUTE_PATTERN = /^\[(discrete|%[^\]]*|cols=[^\]]*)\]$/
const BLOCK_DELIMITER_PATTERN = /^={4,}$/
const SECTION_TITLE_PATTERN = /^={2,}\s+(.+)$/
const CODE_DELIMITER = '----'
const TABLE_DELIMITER = '|==='

function capitalized(word: string): string {
  return word.charAt(0) + word.slice(1).toLowerCase()
}

export function parseDiscussion(text: string): DiscussionBlock[] {
  const lines = text.split('\n')
  const blocks: DiscussionBlock[] = []
  let paragraphLines: string[] = []

  function flushParagraph() {
    if (paragraphLines.length > 0) blocks.push({ kind: 'paragraph', text: paragraphLines.join('\n') })
    paragraphLines = []
  }

  // Collects lines from `start` until `isEnd` matches; returns the index of
  // the line that ended the block (or lines.length).
  function collectCode(start: number, isEnd: (line: string) => boolean): number {
    const codeLines: string[] = []
    let lineIndex = start
    while (lineIndex < lines.length && !isEnd(lines[lineIndex])) {
      codeLines.push(lines[lineIndex])
      lineIndex += 1
    }
    blocks.push({ kind: 'code', text: codeLines.join('\n') })
    return lineIndex
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const trimmed = lines[lineIndex].trim()

    if (SOURCE_ATTRIBUTE_PATTERN.test(trimmed)) {
      flushParagraph()
      if (lines[lineIndex + 1]?.trim() === CODE_DELIMITER) {
        lineIndex = collectCode(lineIndex + 2, (line) => line.trim() === CODE_DELIMITER)
      } else {
        // Some upstream rules omit the ---- delimiters; the listing then
        // runs to the next blank line.
        lineIndex = collectCode(lineIndex + 1, (line) => line.trim() === '')
      }
      continue
    }
    if (trimmed === CODE_DELIMITER || trimmed === TABLE_DELIMITER) {
      flushParagraph()
      lineIndex = collectCode(lineIndex + 1, (line) => line.trim() === trimmed)
      continue
    }

    const admonition = ADMONITION_PATTERN.exec(trimmed)
    if (admonition) {
      flushParagraph()
      blocks.push({ kind: 'heading', text: capitalized(admonition[1]) })
      continue
    }
    const sectionTitle = SECTION_TITLE_PATTERN.exec(trimmed)
    if (sectionTitle) {
      flushParagraph()
      blocks.push({ kind: 'heading', text: sectionTitle[1] })
      continue
    }
    if (IGNORED_ATTRIBUTE_PATTERN.test(trimmed) || BLOCK_DELIMITER_PATTERN.test(trimmed)) {
      flushParagraph()
      continue
    }

    if (trimmed === '') flushParagraph()
    else paragraphLines.push(lines[lineIndex].trimEnd())
  }
  flushParagraph()
  return blocks
}

const MARKDOWN_BULLET_PREFIX = '- '

export function parseMarkdownDiscussion(text: string): DiscussionBlock[] {
  const blocks: DiscussionBlock[] = []
  let paragraphLines: string[] = []
  let listItems: string[] = []

  function flushParagraph() {
    if (paragraphLines.length > 0) blocks.push({ kind: 'paragraph', text: paragraphLines.join('\n') })
    paragraphLines = []
  }
  function flushList() {
    if (listItems.length > 0) blocks.push({ kind: 'list', items: listItems })
    listItems = []
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') {
      flushParagraph()
      flushList()
    } else if (trimmed.startsWith(MARKDOWN_BULLET_PREFIX)) {
      flushParagraph()
      listItems.push(trimmed.slice(MARKDOWN_BULLET_PREFIX.length).trim())
    } else {
      flushList()
      paragraphLines.push(line.trimEnd())
    }
  }
  flushParagraph()
  flushList()
  return blocks
}

export function parseDiscussionIn(format: DiscussionFormat, text: string): DiscussionBlock[] {
  return format === 'markdown' ? parseMarkdownDiscussion(text) : parseDiscussion(text)
}

// Alternatives are tried left to right at each position, so a link macro
// wins over the bare URL inside it, and a URL wins over underscores in it.
// Only http(s) URLs are ever turned into links.
const INLINE_PATTERN = new RegExp(
  [
    String.raw`link:(?<macroHref>https?:\/\/[^\s\[\]]+)\[(?<macroText>[^\]]*)\]`,
    String.raw`(?<bareHref>https?:\/\/[^\s<>()\[\]]*[^\s<>()\[\].,;:!?'"])`,
    '`(?<code>[^`\\n]+)`',
    String.raw`(?<![A-Za-z0-9_])_(?<emphasis>[^_\n]+?)_(?![A-Za-z0-9_])`,
  ].join('|'),
  'g',
)

const MARKDOWN_INLINE_PATTERN = new RegExp(
  String.raw`\[(?<markdownText>[^\[\]]+)\]\((?<markdownHref>https?:\/\/[^\s()]+)\)`,
  'g',
)

export function parseInline(text: string, format: DiscussionFormat = 'asciidoc'): InlineSegment[] {
  const segments: InlineSegment[] = []
  let consumedUpTo = 0
  const pattern = format === 'markdown' ? MARKDOWN_INLINE_PATTERN : INLINE_PATTERN

  for (const match of text.matchAll(pattern)) {
    if (match.index > consumedUpTo) segments.push({ kind: 'text', text: text.slice(consumedUpTo, match.index) })
    const groups = match.groups ?? {}

    if (groups.markdownHref !== undefined) {
      segments.push({ kind: 'link', text: groups.markdownText, href: groups.markdownHref })
    } else if (groups.macroHref !== undefined) {
      segments.push({ kind: 'link', text: groups.macroText || groups.macroHref, href: groups.macroHref })
    } else if (groups.bareHref !== undefined) {
      segments.push({ kind: 'link', text: groups.bareHref, href: groups.bareHref })
    } else if (groups.code !== undefined) {
      segments.push({ kind: 'code', text: groups.code })
    } else {
      segments.push({ kind: 'emphasis', text: groups.emphasis })
    }
    consumedUpTo = match.index + match[0].length
  }

  if (consumedUpTo < text.length) segments.push({ kind: 'text', text: text.slice(consumedUpTo) })
  return segments
}
