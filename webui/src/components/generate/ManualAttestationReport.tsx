import type { ManualAttestationEntry } from '../../logic/chunking'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { LinkedText } from '../rules/LinkedText'

const HEADING_ID = 'manual-attestation-heading'

export function ManualAttestationReport({ entries }: { entries: ManualAttestationEntry[] }) {
  if (entries.length === 0) return null

  return (
    <section aria-labelledby={HEADING_ID} className="mt-4 rounded border border-border bg-panel p-3 text-sm">
      <h3 id={HEADING_ID} className="mb-1 font-medium text-foreground">
        Needs manual attestation ({entries.length})
      </h3>
      <p className="mb-2 text-xs text-muted-foreground">
        No script checks these rules. They are listed in manual-attestation.md in the download.
      </p>
      <ul className="space-y-2 text-xs text-foreground/80">
        {entries.map((entry) => (
          <li key={entry.id} className="break-words">
            <span className="font-mono break-all">{upstreamRuleId(entry.id)}</span> - {entry.title}
            <p className="mt-0.5 text-muted-foreground">{entry.reason}</p>
            {entry.additionalInfo && (
              <details className="mt-0.5 text-muted-foreground">
                <summary className="cursor-pointer text-foreground/80">mSCP guidance</summary>
                <p className="mt-1 whitespace-pre-line"><LinkedText text={entry.additionalInfo} /></p>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
