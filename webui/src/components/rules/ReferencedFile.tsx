import { useReferencedText } from '../../hooks/useReferencedText'
import { fileNameOf, payloadFileDisplay } from '../../logic/fileReferences'
import { containsOdvPlaceholder } from '../../logic/odv'
import type { OrgDefinedValue } from '../../logic/selectionEntry'
import { CodeBlock, OdvNote } from './CodeBlock'

function FileText({ path, odvValue }: { path: string; odvValue: OrgDefinedValue | null }) {
  const state = useReferencedText(path)
  if (state.status === 'loading') return <p className="text-xs text-slate-500">Loading {fileNameOf(path)}…</p>
  if (state.status === 'error') {
    return (
      <p data-testid="referenced-file-error" className="text-xs break-words text-red-600">
        {state.message}
      </p>
    )
  }
  return (
    <>
      <CodeBlock code={state.text} />
      {containsOdvPlaceholder(state.text) && <OdvNote odvValue={odvValue} />}
    </>
  )
}

// A script from shell_file, shown exactly like an inline one once loaded.
export function ScriptFile({ path, odvValue }: { path: string; odvValue: OrgDefinedValue | null }) {
  return <FileText path={path} odvValue={odvValue} />
}

// A payload from data_file: a text file is shown in full and offered for
// download; a binary one (.pol, .intunewin) only as a download.
export function PayloadFile({ label, path, odvValue }: { label: string; path: string; odvValue: OrgDefinedValue | null }) {
  const display = payloadFileDisplay(path, import.meta.env.BASE_URL, window.location.origin)
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      {display.showsContent && <FileText path={path} odvValue={odvValue} />}
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
