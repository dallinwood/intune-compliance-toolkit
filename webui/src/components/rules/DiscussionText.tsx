import { parseDiscussionIn, parseInline, type DiscussionFormat, type InlineSegment } from '../../logic/discussionMarkup'
import { sourceAttributeHighlightLanguage } from '../../logic/codeLanguage'
import { displayWithOdv, type CodeOdvValues } from '../../logic/odv'
import type { OrgDefinedValue } from '../../logic/selectionEntry'
import { OdvCodeBlock } from './CodeBlock'

function InlineText({ text, format }: { text: string; format: DiscussionFormat }) {
  return parseInline(text, format).map((segment: InlineSegment, segmentIndex) => {
    switch (segment.kind) {
      case 'emphasis':
        return <em key={segmentIndex}>{segment.text}</em>
      case 'code':
        return (
          <code key={segmentIndex} className="rounded bg-slate-200 dark:bg-muted px-1 font-mono text-xs break-all">
            {segment.text}
          </code>
        )
      case 'link': {
        // Only a bare URL has no break opportunities of its own; prose
        // should wrap at word boundaries.
        const wrapClass = segment.text === segment.href ? 'break-all' : 'break-words'
        return (
          <a key={segmentIndex} className={`${wrapClass} text-blue-600 dark:text-blue-400 underline`} href={segment.href} target="_blank" rel="noreferrer">
            {segment.text}
          </a>
        )
      }
      default:
        return <span key={segmentIndex}>{segment.text}</span>
    }
  })
}

// $ODV is substituted per block, after parsing, so a value can never be
// read as markup delimiters such as ---- or [source].
export function DiscussionText({
  text,
  format,
  odvValue,
  codeOdv,
}: {
  text: string
  format: DiscussionFormat
  odvValue: OrgDefinedValue | null
  codeOdv: CodeOdvValues
}) {
  return (
    <div className="space-y-2 text-slate-700 dark:text-zinc-200">
      {parseDiscussionIn(format, text).map((block, blockIndex) => {
        if (block.kind === 'list') {
          return (
            <ul key={blockIndex} className="list-disc space-y-1 pl-5 break-words">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <InlineText text={displayWithOdv(item, odvValue)} format={format} />
                </li>
              ))}
            </ul>
          )
        }
        if (block.kind === 'code') {
          return (
            <OdvCodeBlock
              key={blockIndex}
              code={block.text}
              language={sourceAttributeHighlightLanguage(block.sourceLanguage)}
              odvValue={odvValue}
              codeOdv={codeOdv}
            />
          )
        }
        const blockText = displayWithOdv(block.text, odvValue)
        if (block.kind === 'heading') {
          return (
            <p key={blockIndex} className="font-semibold text-slate-800 dark:text-foreground">
              {blockText}
            </p>
          )
        }
        return (
          <p key={blockIndex} className="break-words whitespace-pre-line">
            <InlineText text={blockText} format={format} />
          </p>
        )
      })}
    </div>
  )
}
