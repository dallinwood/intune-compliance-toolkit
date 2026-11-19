import { useReferencedText } from '../../hooks/useReferencedText'
import { payloadFileHighlightLanguage, type HighlightLanguage } from '../../logic/codeLanguage'
import { fileNameOf, payloadFileDisplay } from '../../logic/fileReferences'
import type { CodeOdvValues } from '../../logic/odv'
import type { OdvValues } from '../../logic/selectionEntry'
import { OdvCodeBlock } from './CodeBlock'

function FileText({
  path,
  language,
  odvValues,
  codeOdv,
  isVerifiedShell = false,
}: {
  path: string
  language: HighlightLanguage | undefined
  odvValues: Partial<OdvValues>
  codeOdv: CodeOdvValues
  isVerifiedShell?: boolean
}) {
  const state = useReferencedText(path)
  if (state.status === 'loading') return <p className="text-xs text-muted-foreground">Loading {fileNameOf(path)}…</p>
  if (state.status === 'error') {
    return (
      <p data-testid="referenced-file-error" className="text-xs break-words text-destructive">
        {state.message}
      </p>
    )
  }
  return <OdvCodeBlock code={state.text} language={language} odvValues={odvValues} codeOdv={codeOdv} isVerifiedShell={isVerifiedShell} />
}

// A script from shell_file, shown exactly like an inline one once loaded.
export function ScriptFile({
  path,
  language,
  odvValues,
  codeOdv,
}: {
  path: string
  language: HighlightLanguage | undefined
  odvValues: Partial<OdvValues>
  codeOdv: CodeOdvValues
}) {
  return <FileText path={path} language={language} odvValues={odvValues} codeOdv={codeOdv} isVerifiedShell />
}

// A payload from data_file: a text file is shown in full and offered for
// download; a binary one (.pol, .intunewin) only as a download.
export function PayloadFile({
  label,
  path,
  odvValues,
  codeOdv,
}: {
  label: string
  path: string
  odvValues: Partial<OdvValues>
  codeOdv: CodeOdvValues
}) {
  const display = payloadFileDisplay(path, import.meta.env.BASE_URL, window.location.origin)
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-foreground/80">{label}</p>
      {display.showsContent && (
        <FileText path={path} language={payloadFileHighlightLanguage(path)} odvValues={odvValues} codeOdv={codeOdv} />
      )}
      {display.url === null ? (
        <p data-testid="referenced-file-error" className="text-xs break-words text-destructive">
          {display.fileName} is outside the published baselines/ folder, so it is not offered.
        </p>
      ) : (
        <a className="text-xs break-all text-link underline" href={display.url} download={display.fileName}>
          Download {display.fileName}
        </a>
      )}
    </div>
  )
}
