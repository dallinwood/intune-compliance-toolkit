import { Download } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { registryFileBytes, registryFileName, type RegistryFilePurpose, registryFileProblem, registryFileText } from '../../logic/registryFile'
import { registryRows, type RegistryRow } from '../../logic/registryRows'
import { odvPlaceholder } from '../../logic/odv'
import type { OdvValues } from '../../logic/selectionEntry'
import type { RegistrySetting } from '../../types/library'

function downloadRegistryFile(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([registryFileBytes(text) as BlobPart], { type: 'application/octet-stream' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  // Revoking synchronously can cancel the download in some browsers before
  // it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// The data of a row; one that comes from an organization-defined value is
// marked like a substituted value in a script.
function DataText({ row }: { row: RegistryRow }) {
  if (row.action === 'Delete') return <span className="text-muted-foreground italic">Delete this value</span>
  const text = <span className="whitespace-pre-wrap">{row.data}</span>
  if (row.odvName === null) return text
  return (
    <span className="rounded bg-foreground/10 px-1" title={`Organization-defined value ${odvPlaceholder(row.odvName)}`}>
      {text}
    </span>
  )
}

function FullPath({ row }: { row: RegistryRow }) {
  return (
    <code className="block font-mono text-xs [overflow-wrap:anywhere]">{row.fullPath}</code>
  )
}

const CELL_CLASS = 'px-2 py-1.5 align-top'

function RegistryRowsTable({ rows }: { rows: RegistryRow[] }) {
  return (
    <table className="hidden w-full table-fixed border-collapse text-left text-xs sm:table">
      <colgroup>
        <col className="w-[38%]" />
        <col className="w-[18%]" />
        <col className="w-[14%]" />
        <col />
      </colgroup>
      <thead>
        <tr className="border-b border-border text-muted-foreground">
          <th scope="col" className={`${CELL_CLASS} font-medium`}>Key</th>
          <th scope="col" className={`${CELL_CLASS} font-medium`}>Value</th>
          <th scope="col" className={`${CELL_CLASS} font-medium`}>Type</th>
          <th scope="col" className={`${CELL_CLASS} font-medium`}>Data</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, position) => (
          <tr key={position} className="border-b border-border/60 last:border-b-0">
            <td className={CELL_CLASS}>
              <FullPath row={row} />
            </td>
            <td className={`${CELL_CLASS} font-mono [overflow-wrap:anywhere]`}>{row.valueName}</td>
            <td className={`${CELL_CLASS} font-mono [overflow-wrap:anywhere]`}>{row.type}</td>
            <td className={`${CELL_CLASS} font-mono [overflow-wrap:anywhere]`}>
              <DataText row={row} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function RegistryCards({ rows }: { rows: RegistryRow[] }) {
  return (
    <ul className="space-y-2 sm:hidden">
      {rows.map((row, position) => (
        <li key={position} className="space-y-1 rounded-md border border-border p-2 text-xs">
          <FullPath row={row} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <dt className="text-muted-foreground">Value</dt>
            <dd className="font-mono [overflow-wrap:anywhere]">{row.valueName}</dd>
            {row.type !== '' && (
              <>
                <dt className="text-muted-foreground">Type</dt>
                <dd className="font-mono [overflow-wrap:anywhere]">{row.type}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Data</dt>
            <dd className="font-mono [overflow-wrap:anywhere]">
              <DataText row={row} />
            </dd>
          </dl>
        </li>
      ))}
    </ul>
  )
}

// A registry body shown as what it is: the settings in a table (cards on a
// narrow screen), with a download of the .reg file that sets them below it,
// so the keys sit right under the section's label. The file is
// built from the reader's organization-defined values, so the button is
// disabled, with the reason after it, whenever the file cannot be built.
export function RegistryTable({
  settings,
  odvValues,
  ruleId,
  target,
  purpose,
}: {
  settings: RegistrySetting[]
  odvValues: Partial<OdvValues>
  ruleId: string
  target: string
  purpose: RegistryFilePurpose
}) {
  const rows = registryRows(settings, odvValues)
  const problem = registryFileProblem(settings, odvValues)
  const customisedNames = [...new Set(rows.flatMap((row) => (row.odvName !== null && Object.hasOwn(odvValues, row.odvName) ? [row.odvName] : [])))]
  return (
    <div className="space-y-2">
      <RegistryRowsTable rows={rows} />
      <RegistryCards rows={rows} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          disabled={problem !== null}
          onClick={() => downloadRegistryFile(registryFileText(settings, odvValues), registryFileName(ruleId, target, purpose))}
          className={buttonVariants({ variant: 'outline', size: 'xs' })}
        >
          <Download aria-hidden className="size-3.5" />
          Download .reg
        </button>
        {problem !== null && (
          <p data-testid="registry-download-problem" className="min-w-0 flex-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {problem}
          </p>
        )}
      </div>
      {customisedNames.map((name) => (
        <p key={name} className="text-xs text-muted-foreground">
          Shown with {odvPlaceholder(name)} as the organization-defined value: {String(odvValues[name])}
        </p>
      ))}
    </div>
  )
}
