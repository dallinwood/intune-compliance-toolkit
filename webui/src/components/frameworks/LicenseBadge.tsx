import { Scale } from 'lucide-react'
import type { License } from '../../types/library'

// Styled after the shields.io README badge: a grey key segment and a coloured
// value segment. Every licence shares one colour; colour-coding licences would
// imply a legal judgment the UI shouldn't make.
export function LicenseBadge({ license }: { license: License }) {
  return (
    <a
      href={license.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Licence: ${license.name} (opens in a new tab)`}
      className="inline-flex h-5 shrink-0 overflow-hidden rounded text-[11px] leading-5 font-medium whitespace-nowrap text-white outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
    >
      <span className="inline-flex items-center gap-1 bg-zinc-600 px-1.5 dark:bg-zinc-700">
        <Scale aria-hidden="true" className="size-[11px]" />
        licence
      </span>
      <span className="bg-blue-600 px-1.5 dark:bg-blue-700">{license.name}</span>
    </a>
  )
}
