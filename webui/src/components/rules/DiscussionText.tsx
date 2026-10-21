import { parseDiscussion, parseInline, type InlineSegment } from '../../logic/discussionMarkup'
import { displayWithOdv } from '../../logic/odv'
import type { OrgDefinedValue } from '../../logic/selectionEntry'
import { CodeBlock } from './CodeBlock'

function InlineText({ text }: { text: string }) {
  return parseInline(text).map((segment: InlineSegment, segmentIndex) => {
    switch (segment.kind) {
      case 'emphasis':
        return <em key={segmentIndex}>{segment.text}</em>
      case 'code':
        return (
          <code key={segmentIndex} className="rounded bg-slate-200 px-1 font-mono text-xs break-all">
            {segment.text}
          </code>
        )
      case 'link':
        return (
          <a key={segmentIndex} className="break-all text-blue-600 underline" href={segment.href} target="_blank" rel="noreferrer">
            {segment.text}
          </a>
        )
      default:
        return <span key={segmentIndex}>{segment.text}</span>
    }
  })
}

// $ODV is substituted per block, after parsing, so a value can never be
// read as markup delimiters such as ---- or [source].
export function DiscussionText({ text, odvValue }: { text: string; odvValue: OrgDefinedValue | null }) {
  return (
    <div className="space-y-2 text-slate-700">
      {parseDiscussion(text).map((block, blockIndex) => {
        const blockText = displayWithOdv(block.text, odvValue)
        if (block.kind === 'code') return <CodeBlock key={blockIndex} code={blockText} />
        if (block.kind === 'heading') {
          return (
            <p key={blockIndex} className="font-semibold text-slate-800">
              {blockText}
            </p>
          )
        }
        return (
          <p key={blockIndex} className="break-words whitespace-pre-line">
            <InlineText text={blockText} />
          </p>
        )
      })}
    </div>
  )
}
