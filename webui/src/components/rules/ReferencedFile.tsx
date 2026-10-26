import { useReferencedText } from '../../hooks/useReferencedText'
import { payloadFileHighlightLanguage, type HighlightLanguage } from '../../logic/codeLanguage'
import { fileNameOf, payloadFileDisplay } from '../../logic/fileReferences'
import type { OrgDefinedValue } from '../../logic/selectionEntry'
import { OdvCodeBlock } from './CodeBlock'

function FileText({
  path,
  language,
  odvValue,
  codeOdvValue,
}: {
  path: string
  language: HighlightLanguage | undefined
  odvValue: OrgDefinedValue | null
  codeOdvValue: OrgDefinedValue | null
}) {
  const state = useReferencedText(path)
  if (state.status === 'loading') return <p className="text-xs text-slate-500">Loading {fileNameOf(path)}…</p>
  if (state.status === 'error') {
    return (
      <p data-testid="referenced-file-error" className="text-xs break-words text-red-600">
        {state.message}
      </p>
    )
  }
  return <OdvCodeBlock code={state.text} language={language} odvValue={odvValue} codeOdvValue={codeOdvValue} />
}

// A script from shell_file, shown exactly like an inline one once loaded.
export function ScriptFile({
  path,
  language,
  odvValue,
  codeOdvValue,
}: {
  path: string
  language: HighlightLanguage | undefined
  odvValue: OrgDefinedValue | null
  codeOdvValue: OrgDefinedValue | null
}) {
  return <FileText path={path} language={language} odvValue={odvValue} codeOdvValue={codeOdvValue} />
}

// A payload from data_file: a text file is shown in full and offered for
// download; a binary one (.pol, .intunewin) only as a download.
export function PayloadFile({
  label,
  path,
  odvValue,
  codeOdvValue,
}: {
  label: string
  path: string
  odvValue: OrgDefinedValue | null
  codeOdvValue: OrgDefinedValue | null
}) {
  const display = payloadFileDisplay(path, import.meta.env.BASE_URL, window.location.origin)
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      {display.showsContent && (
        <FileText path={path} language={payloadFileHighlightLanguage(path)} odvValue={odvValue} codeOdvValue={codeOdvValue} />
      )}
      {display.url === null ? (
        <p data-testid="referenced-file-error" className="text-xs break-words text-red-600">
          {display.fileName} is outside the published baselines/ folder, so it is not offered.
        </p>
      ) : (
        <a className="text-xs break-all text-blue-600 underline" href={display.url} download={display.fileName}>
          Download {display.fileName}
        </a>
      )}
    </div>
  )
}
