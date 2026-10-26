import { linkSegments } from '../../logic/links'

export function LinkedText({ text }: { text: string }) {
  return linkSegments(text).map((segment, segmentIndex) =>
    segment.kind === 'link' ? (
      <a key={segmentIndex} className="break-all text-link underline" href={segment.href} target="_blank" rel="noreferrer">
        {segment.text}
      </a>
    ) : (
      <span key={segmentIndex}>{segment.text}</span>
    ),
  )
}
