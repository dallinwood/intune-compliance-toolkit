import { useReferencedText } from '../../hooks/useReferencedText'
import { payloadFileHighlightLanguage, type HighlightLanguage } from '../../logic/codeLanguage'
import { fileNameOf, payloadFileDisplay } from '../../logic/fileReferences'
import type { CodeOdvValues } from '../../logic/odv'
import type { OrgDefinedValue } from '../../logic/selectionEntry'
import { OdvCodeBlock } from './CodeBlock'

function FileText({
  path,
  language,
  odvValue,
  codeOdv,
}: {
  path: string
  language: HighlightLanguage | undefined
  odvValue: OrgDefinedValue | null
  codeOdv: CodeOdvValues
}) {
  const state = useReferencedText(path)
  if (state.status === 'loading') return <p className="text-xs text-slate-500 dark:text-muted-foreground">Loading {fileNameOf(path)}…</p>
  if (state.status === 'error') {
    return (
      <p data-testid="referenced-file-error" className="text-xs break-words text-red-600 dark:text-red-400">
        {state.message}
      </p>
    )
  }
  return <OdvCodeBlock code={state.text} language={language} odvValue={odvValue} codeOdv={codeOdv} />
}

// A script from shell_file, shown exactly like an inline one once loaded.
export function ScriptFile({
  path,
  language,
  odvValue,
  codeOdv,
}: {
  path: string
  language: HighlightLanguage | undefined
  odvValue: OrgDefinedValue | null
  codeOdv: CodeOdvValues
}) {
  return <FileText path={path} language={language} odvValue={odvValue} codeOdv={codeOdv} />
}

// A payload from data_file: a text file is shown in full and offered for
// download; a binary one (.pol, .intunewin) only as a download.
export function PayloadFile({
  label,
  path,
  odvValue,
  codeOdv,
}: {
  label: string
  path: string
  odvValue: OrgDefinedValue | null
  codeOdv: CodeOdvValues
}) {
  const display = payloadFileDisplay(path, import.meta.env.BASE_URL, window.location.origin)
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-600 dark:text-zinc-300">{label}</p>
      {display.showsContent && (
        <FileText path={path} language={payloadFileHighlightLanguage(path)} odvValue={odvValue} codeOdv={codeOdv} />
      )}
      {display.url === null ? (
        <p data-testid="referenced-file-error" className="text-xs break-words text-red-600 dark:text-red-400">
          {display.fileName} is outside the published baselines/ folder, so it is not offered.
        </p>
      ) : (
        <a className="text-xs break-all text-blue-600 dark:text-blue-400 underline" href={display.url} download={display.fileName}>
          Download {display.fileName}
        </a>
      )}
    </div>
  )
}
