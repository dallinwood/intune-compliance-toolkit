import type { ManualAttestationEntry } from '../../logic/chunking'

export function ManualAttestationReport({ entries }: { entries: ManualAttestationEntry[] }) {
  if (entries.length === 0) return null

  return (
    <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
      <h3 className="mb-2 font-medium text-slate-700">Needs manual attestation ({entries.length})</h3>
      <ul className="space-y-1 text-xs text-slate-600">
        {entries.map((entry) => (
          <li key={entry.ref.id}>
            <span className="font-mono">{entry.id}</span> — {entry.title}: {entry.reason}
          </li>
        ))}
      </ul>
    </div>
  )
}
