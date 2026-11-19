import 'highlight.js/styles/github-dark.css'
import './codeBlock.css'
import type { HighlightLanguage } from '../../logic/codeLanguage'
import { highlightedHtml } from '../../logic/highlighting'
import { codeTextWithOdvs, containsOdvPlaceholder, displayWithOdvs, odvPlaceholder, odvPlaceholderNames, type CodeOdvValues } from '../../logic/odv'
import { expandsOdvOnlyAsQuotedVariable, shellWithExportedOdv } from '../../logic/odvExportDisplay'
import type { OdvValues, OrgDefinedValue } from '../../logic/selectionEntry'
import { CopyButton } from './CopyButton'
import { CustomTag } from './CustomTag'

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
      <pre className="max-w-full overflow-x-auto rounded-md bg-code p-2 pr-10 font-mono text-xs whitespace-pre-wrap text-code-foreground dark:ring-1 dark:ring-white/10 [overflow-wrap:anywhere]">
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

// Shown under a script or payload that is displayed raw with $ODV_<name> in it:
// one line naming each placeholder left in it.
export function OdvNote({ names, odvValues }: { names: string[]; odvValues: Partial<OdvValues> }) {
  return (
    <>
      {names.map((name) => (
        <p key={name} className="text-xs text-muted-foreground">
          {odvPlaceholder(name)} stands for the organization-defined value, currently{' '}
          {shortenedValue(displayWithOdvs(odvPlaceholder(name), odvValues))}.
        </p>
      ))}
    </>
  )
}

function shownValueNames(code: string, values: Partial<OdvValues>): string[] {
  return odvPlaceholderNames(code).filter((name) => Object.hasOwn(values, name))
}

// Shown under a block whose $ODV_<name> placeholders have been replaced with values.
function OdvSubstitutionNote({ code, values }: { code: string; values: Partial<OdvValues> }) {
  return (
    <>
      {shownValueNames(code, values).map((name) => (
        <p key={name} className="text-xs text-muted-foreground">
          Shown with {odvPlaceholder(name)} as the organization-defined value: {shortenedValue(String(values[name] as OrgDefinedValue))}
        </p>
      ))}
    </>
  )
}

function OdvExportNote({ names }: { names: string[] }) {
  return (
    <p className="text-xs text-muted-foreground">
      Shown with the organization-defined value set as {names.map((name) => `ODV_${name}`).join(', ')}, as the generated script does.
    </p>
  )
}

// A block of shipped code that may contain $ODV_<name>. codeOdv holds the values safe
// to show in place of each placeholder; a placeholder without one stays literal and is explained.
export function OdvCodeBlock({
  code,
  language,
  odvValues,
  codeOdv,
  isJson = false,
}: {
  code: string
  language?: HighlightLanguage
  odvValues: Partial<OdvValues>
  codeOdv: CodeOdvValues
  isJson?: boolean
}) {
  const codeOdvValuesForBlock = isJson ? codeOdv.json : codeOdv.script
  if (!containsOdvPlaceholder(code)) return <CodeBlock code={code} language={language} />

  const exportedNames =
    !isJson && language === 'bash'
      ? shownValueNames(code, codeOdv.exported).filter((name) => expandsOdvOnlyAsQuotedVariable(code, name))
      : []
  if (exportedNames.length > 0) {
    const exportedCode = exportedNames.reduceRight(
      (shell, name) => shellWithExportedOdv(shell, name, codeOdv.exported[name] as OrgDefinedValue),
      code,
    )
    const unexportedNames = odvPlaceholderNames(code).filter((name) => !exportedNames.includes(name))
    return (
      <>
        <CodeBlock code={exportedCode} language={language} />
        <OdvExportNote names={exportedNames} />
        {unexportedNames.length > 0 && <OdvNote names={unexportedNames} odvValues={odvValues} />}
      </>
    )
  }

  const shownNames = shownValueNames(code, codeOdvValuesForBlock)
  const displayedCode = shownNames.length > 0 ? codeTextWithOdvs(code, codeOdvValuesForBlock, isJson) : code
  const hiddenNames = odvPlaceholderNames(displayedCode)
  return (
    <>
      <CodeBlock code={displayedCode} language={language} />
      <OdvSubstitutionNote code={code} values={codeOdvValuesForBlock} />
      {hiddenNames.length > 0 && <OdvNote names={hiddenNames} odvValues={odvValues} />}
    </>
  )
}

export function SectionHeading({ children, custom = false }: { children: string; custom?: boolean }) {
  const heading = <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</h3>
  if (!custom) return heading
  return (
    <div className="flex items-center gap-2">
      {heading}
      <CustomTag />
    </div>
  )
}
