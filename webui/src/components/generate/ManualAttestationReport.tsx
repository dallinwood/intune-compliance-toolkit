import type { ManualAttestationEntry } from '../../logic/chunking'
import { upstreamRuleId } from '../../logic/ruleDisplay'

const HEADING_ID = 'manual-attestation-heading'

export function ManualAttestationReport({ entries }: { entries: ManualAttestationEntry[] }) {
  if (entries.length === 0) return null

  return (
    <section aria-labelledby={HEADING_ID} className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
      <h3 id={HEADING_ID} className="mb-1 font-medium text-slate-800">
        Needs manual attestation ({entries.length})
      </h3>
      <p className="mb-2 text-xs text-slate-500">
        No script checks these rules. They are listed in manual-attestation.md in the download.
      </p>
      <ul className="space-y-2 text-xs text-slate-600">
        {entries.map((entry) => (
          <li key={entry.id} className="break-words">
            <span className="font-mono break-all">{upstreamRuleId(entry.id)}</span> - {entry.title}
            <p className="mt-0.5 text-slate-500">{entry.reason}</p>
            {entry.additionalInfo && (
              <details className="mt-0.5 text-slate-500">
                <summary className="cursor-pointer text-slate-600">mSCP guidance</summary>
                <p className="mt-1 whitespace-pre-line">{entry.additionalInfo}</p>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
