import { displayWithOdv } from '../../logic/odv'
import type { OrgDefinedValue } from '../../logic/selectionEntry'
import { CustomTag } from './CustomTag'

const ODV_PLACEHOLDER = '$ODV'
const MAX_NOTE_VALUE_LENGTH = 80

// Long single-line check commands wrap (anywhere, since they rarely contain
// spaces at useful points) so the whole command is readable on a phone;
// overflow-x-auto remains a fallback rather than the primary behaviour.
export function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="max-w-full overflow-x-auto rounded bg-slate-900 p-2 font-mono text-xs whitespace-pre-wrap text-slate-100 [overflow-wrap:anywhere]">
      <code>{code}</code>
    </pre>
  )
}

// Banners run to hundreds of characters, which would swamp the block itself.
function shortenedValue(text: string): string {
  return text.length > MAX_NOTE_VALUE_LENGTH ? `${text.slice(0, MAX_NOTE_VALUE_LENGTH)}...` : text
}

// Shown under a script or payload that is displayed raw with $ODV in it.
export function OdvNote({ odvValue }: { odvValue: OrgDefinedValue | null }) {
  return (
    <p className="text-xs text-slate-500">
      $ODV stands for the organization-defined value, currently{' '}
      {shortenedValue(displayWithOdv(ODV_PLACEHOLDER, odvValue))}.
    </p>
  )
}

export function SectionHeading({ children, custom = false }: { children: string; custom?: boolean }) {
  const heading = <h5 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{children}</h5>
  if (!custom) return heading
  return (
    <div className="flex items-center gap-2">
      {heading}
      <CustomTag />
    </div>
  )
}

// Heads one target's block inside the Check or Remediation section.
export function TargetHeading({ children }: { children: string }) {
  return <p className="text-xs font-semibold text-slate-700">{children}</p>
}
