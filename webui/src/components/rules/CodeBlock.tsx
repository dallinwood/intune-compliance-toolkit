import 'highlight.js/styles/github-dark.css'
import './codeBlock.css'
import type { HighlightLanguage } from '../../logic/codeLanguage'
import { highlightedHtml } from '../../logic/highlighting'
import { codeTextWithOdv, containsOdvPlaceholder, displayWithOdv, type CodeOdvValues } from '../../logic/odv'
import { expandsOdvOnlyAsQuotedVariable, shellWithExportedOdv } from '../../logic/odvExportDisplay'
import type { OrgDefinedValue } from '../../logic/selectionEntry'
import { CopyButton } from './CopyButton'
import { CustomTag } from './CustomTag'

const ODV_PLACEHOLDER = '$ODV'
const MAX_NOTE_VALUE_LENGTH = 80

// Long single-line check commands wrap (anywhere, since they rarely contain
// spaces at useful points) so the whole command is readable on a phone;
// overflow-x-auto remains a fallback rather than the primary behaviour.
// Inserting the highlighted HTML is safe because highlight.js escapes the
// code before it adds its span markup (see highlightedHtml).
export function CodeBlock({ code, language }: { code: string; language?: HighlightLanguage }) {
  const html = highlightedHtml(code, language)
  return (
    <div className="relative">
      <pre className="max-w-full overflow-x-auto rounded bg-slate-900 p-2 dark:ring-1 dark:ring-white/10 pr-10 font-mono text-xs whitespace-pre-wrap text-slate-100 [overflow-wrap:anywhere]">
        {html === null ? <code>{code}</code> : <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />}
      </pre>
      <CopyButton text={code} />
    </div>
  )
}

// Banners run to hundreds of characters, which would swamp the block itself.
function shortenedValue(text: string): string {
  return text.length > MAX_NOTE_VALUE_LENGTH ? `${text.slice(0, MAX_NOTE_VALUE_LENGTH)}...` : text
}

// Shown under a script or payload that is displayed raw with $ODV in it.
export function OdvNote({ odvValue }: { odvValue: OrgDefinedValue | null }) {
  return (
    <p className="text-xs text-slate-500 dark:text-muted-foreground">
      $ODV stands for the organization-defined value, currently{' '}
      {shortenedValue(displayWithOdv(ODV_PLACEHOLDER, odvValue))}.
    </p>
  )
}

// Shown under a block whose $ODV has been replaced with the value.
function OdvSubstitutionNote({ value }: { value: OrgDefinedValue }) {
  return <p className="text-xs text-slate-500 dark:text-muted-foreground">Shown with the organization-defined value: {shortenedValue(String(value))}</p>
}

function OdvExportNote() {
  return <p className="text-xs text-slate-500 dark:text-muted-foreground">Shown with the organization-defined value set as ODV, as the generated script does.</p>
}

// A block of shipped code that may contain $ODV. codeOdv holds the values safe to
// show in its place, or null to keep the literal placeholder and explain it.
export function OdvCodeBlock({
  code,
  language,
  odvValue,
  codeOdv,
  isJson = false,
}: {
  code: string
  language?: HighlightLanguage
  odvValue: OrgDefinedValue | null
  codeOdv: CodeOdvValues
  isJson?: boolean
}) {
  const codeOdvValue = isJson ? codeOdv.json : codeOdv.script
  if (!containsOdvPlaceholder(code)) return <CodeBlock code={code} language={language} />
  if (!isJson && codeOdv.exported !== null && language === 'bash' && expandsOdvOnlyAsQuotedVariable(code)) {
    return (
      <>
        <CodeBlock code={shellWithExportedOdv(code, codeOdv.exported)} language={language} />
        <OdvExportNote />
      </>
    )
  }
  if (codeOdvValue === null) {
    return (
      <>
        <CodeBlock code={code} language={language} />
        <OdvNote odvValue={odvValue} />
      </>
    )
  }
  const displayedCode = codeTextWithOdv(code, codeOdvValue, isJson)
  return (
    <>
      <CodeBlock code={displayedCode} language={language} />
      <OdvSubstitutionNote value={codeOdvValue} />
    </>
  )
}

export function SectionHeading({ children, custom = false }: { children: string; custom?: boolean }) {
  const heading = <h5 className="text-xs font-semibold tracking-wide text-slate-500 dark:text-muted-foreground uppercase">{children}</h5>
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
  return <p className="text-xs font-semibold text-slate-700 dark:text-zinc-200">{children}</p>
}
