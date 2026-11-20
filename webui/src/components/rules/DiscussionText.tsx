import { nestListItems, parseDiscussionIn, parseInline, type DiscussionFormat, type InlineSegment, type ListNode } from '../../logic/discussionMarkup'
import { sourceAttributeHighlightLanguage } from '../../logic/codeLanguage'
import { displayWithOdvs, type CodeOdvValues } from '../../logic/odv'
import type { OdvValues } from '../../logic/selectionEntry'
import { OdvCodeBlock } from './CodeBlock'

function InlineText({ text, format }: { text: string; format: DiscussionFormat }) {
  return parseInline(text, format).map((segment: InlineSegment, segmentIndex) => {
    switch (segment.kind) {
      case 'emphasis':
        return <em key={segmentIndex}>{segment.text}</em>
      case 'strong':
        return (
          <strong key={segmentIndex} className="font-semibold text-foreground">
            {segment.text}
          </strong>
        )
      case 'code':
        return (
          <code key={segmentIndex} className="rounded bg-foreground/10 px-1 font-mono text-xs break-all">
            {segment.text}
          </code>
        )
      case 'link': {
        // Only a bare URL has no break opportunities of its own; prose
        // should wrap at word boundaries.
        const wrapClass = segment.text === segment.href ? 'break-all' : 'break-words'
        return (
          <a key={segmentIndex} className={`${wrapClass} text-link underline`} href={segment.href} target="_blank" rel="noreferrer">
            {segment.text}
          </a>
        )
      }
      default:
        return <span key={segmentIndex}>{segment.text}</span>
    }
  })
}

function NestedList({
  nodes,
  format,
  odvValues,
  isNested = false,
}: {
  nodes: ListNode[]
  format: DiscussionFormat
  odvValues: Partial<OdvValues>
  isNested?: boolean
}) {
  return (
    <ul className={`${isNested ? 'mt-1 list-[circle]' : 'list-disc'} space-y-1 pl-5 break-words`}>
      {nodes.map((node, nodeIndex) => (
        <li key={nodeIndex}>
          <InlineText text={displayWithOdvs(node.text, odvValues)} format={format} />
          {node.children.length > 0 && <NestedList nodes={node.children} format={format} odvValues={odvValues} isNested />}
        </li>
      ))}
    </ul>
  )
}

// $ODV is substituted per block, after parsing, so a value can never be
// read as markup delimiters such as ---- or [source].
export function DiscussionText({
  text,
  format,
  odvValues,
  codeOdv,
}: {
  text: string
  format: DiscussionFormat
  odvValues: Partial<OdvValues>
  codeOdv: CodeOdvValues
}) {
  return (
    <div className="space-y-2 text-foreground/90">
      {parseDiscussionIn(format, text).map((block, blockIndex) => {
        if (block.kind === 'list') {
          return <NestedList key={blockIndex} nodes={nestListItems(block.items)} format={format} odvValues={odvValues} />
        }
        if (block.kind === 'code') {
          return (
            <OdvCodeBlock
              key={blockIndex}
              code={block.text}
              language={sourceAttributeHighlightLanguage(block.sourceLanguage)}
              odvValues={odvValues}
              codeOdv={codeOdv}
            />
          )
        }
        const blockText = displayWithOdvs(block.text, odvValues)
        if (block.kind === 'heading') {
          return (
            <p key={blockIndex} className="font-semibold text-foreground">
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
