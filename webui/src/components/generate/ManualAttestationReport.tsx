import { useId, useState } from 'react'
import type { ManualAttestationEntry } from '../../logic/chunking'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { LinkedText } from '../rules/LinkedText'

const HEADING_ID = 'manual-attestation-heading'

function EntryList({ entries }: { entries: ManualAttestationEntry[] }) {
  return (
    <ul className="space-y-2 text-xs text-foreground/80">
      {entries.map((entry) => (
        <li key={entry.id} className="break-words">
          <span className="font-mono break-all">{upstreamRuleId(entry.id)}</span> - {entry.title}
          <p className="mt-0.5 text-muted-foreground">{entry.reason}</p>
          {entry.automatedSupportRuleIds.length > 0 && (
            <p className="mt-0.5 text-foreground/80">
              Automated support: {entry.automatedSupportRuleIds.map(upstreamRuleId).join(', ')}
            </p>
          )}
          {entry.additionalInfo && (
            <details className="mt-0.5 text-muted-foreground">
              <summary className="cursor-pointer text-foreground/80">mSCP guidance</summary>
              <p className="mt-1 whitespace-pre-line"><LinkedText text={entry.additionalInfo} /></p>
            </details>
          )}
        </li>
      ))}
    </ul>
  )
}

function Group({ heading, entries, startsOpen }: { heading: string; entries: ManualAttestationEntry[]; startsOpen: boolean }) {
  const [open, setOpen] = useState(startsOpen)
  const listId = useId()
  return (
    <div className="mt-2">
      <h4 className="font-medium text-foreground">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen(!open)}
          className="rounded-sm text-left underline focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
        >
          {heading} ({entries.length})
        </button>
      </h4>
      <div id={listId} hidden={!open} className="mt-2">
        {open && <EntryList entries={entries} />}
      </div>
    </div>
  )
}

export function ManualAttestationReport({ entries }: { entries: ManualAttestationEntry[] }) {
  if (entries.length === 0) return null

  const supported = entries.filter((entry) => entry.automatedSupportRuleIds.length > 0)
  const unsupported = entries.filter((entry) => entry.automatedSupportRuleIds.length === 0)

  return (
    <section aria-labelledby={HEADING_ID} className="mt-4 rounded border border-border bg-panel p-3 text-sm">
      <h3 id={HEADING_ID} className="mb-1 font-medium text-foreground">
        Needs manual attestation ({entries.length})
      </h3>
      <p className="mb-2 text-xs text-muted-foreground">
        No script checks these rules. They are listed in manual-attestation.md in the download.
      </p>
      {supported.length === 0 ? (
        <EntryList entries={entries} />
      ) : (
        <>
          {unsupported.length > 0 && <Group heading="No automated support" entries={unsupported} startsOpen />}
          <Group heading="Supported by automated checks in this bundle" entries={supported} startsOpen={false} />
        </>
      )}
    </section>
  )
}
