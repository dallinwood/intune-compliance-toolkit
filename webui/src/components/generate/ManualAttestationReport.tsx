import type { ManualAttestationEntry } from '../../logic/chunking'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { LinkedText } from '../rules/LinkedText'

const HEADING_ID = 'manual-attestation-heading'

export function ManualAttestationReport({ entries }: { entries: ManualAttestationEntry[] }) {
  if (entries.length === 0) return null

  return (
    <section aria-labelledby={HEADING_ID} className="mt-4 rounded border border-slate-200 dark:border-border bg-slate-50 dark:bg-card p-3 text-sm">
      <h3 id={HEADING_ID} className="mb-1 font-medium text-slate-800 dark:text-foreground">
        Needs manual attestation ({entries.length})
      </h3>
      <p className="mb-2 text-xs text-slate-500 dark:text-muted-foreground">
        No script checks these rules. They are listed in manual-attestation.md in the download.
      </p>
      <ul className="space-y-2 text-xs text-slate-600 dark:text-zinc-300">
        {entries.map((entry) => (
          <li key={entry.id} className="break-words">
            <span className="font-mono break-all">{upstreamRuleId(entry.id)}</span> - {entry.title}
            <p className="mt-0.5 text-slate-500 dark:text-muted-foreground">{entry.reason}</p>
            {entry.additionalInfo && (
              <details className="mt-0.5 text-slate-500 dark:text-muted-foreground">
                <summary className="cursor-pointer text-slate-600 dark:text-zinc-300">mSCP guidance</summary>
                <p className="mt-1 whitespace-pre-line"><LinkedText text={entry.additionalInfo} /></p>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
