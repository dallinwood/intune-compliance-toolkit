import { useId, useState } from 'react'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { severityCounts, type CheckSeverity, type GenerateCheck } from '../../logic/generateChecks'

const SEVERITY_TAG_LABELS: Record<CheckSeverity, string> = { error: 'Error', warning: 'Warning', info: 'Note' }

const SEVERITY_TAG_CLASSES: Record<CheckSeverity, string> = {
  error: 'border-warning-border bg-warning text-warning-foreground',
  warning: 'border-warning-border bg-warning text-warning-foreground',
  info: 'border-border bg-muted text-muted-foreground',
}

const COUNT_NOUNS: Record<CheckSeverity, { singular: string; plural: string }> = {
  error: { singular: 'error', plural: 'errors' },
  warning: { singular: 'warning', plural: 'warnings' },
  info: { singular: 'note', plural: 'notes' },
}

function countSummary(checks: readonly GenerateCheck[]): string {
  const counts = severityCounts(checks)
  return (['error', 'warning', 'info'] as const)
    .filter((severity) => counts[severity] > 0)
    .map((severity) => {
      const nouns = COUNT_NOUNS[severity]
      return `${counts[severity]} ${counts[severity] === 1 ? nouns.singular : nouns.plural}`
    })
    .join(', ')
}

function CheckRow({ check }: { check: GenerateCheck }) {
  const [open, setOpen] = useState(check.severity !== 'info')
  const listId = useId()
  const occurrenceCount = check.occurrences.length

  return (
    <li data-check-id={check.id} className="rounded border border-border bg-panel p-3">
      <div className="flex items-start gap-2">
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium ${SEVERITY_TAG_CLASSES[check.severity]}`}>
          {SEVERITY_TAG_LABELS[check.severity]}
        </span>
        <p className="min-w-0 break-words text-foreground">{check.message}</p>
      </div>
      {occurrenceCount > 0 && (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((wasOpen) => !wasOpen)}
            className="mt-2 text-xs text-link underline"
          >
            {open ? 'Hide' : 'Show'} {occurrenceCount} {occurrenceCount === 1 ? 'rule' : 'rules'}
          </button>
          {open && (
            <ul id={listId} className="mt-2 space-y-2 border-l border-border pl-3">
              {check.occurrences.map((occurrence, occurrenceIndex) => (
                <li key={`${occurrence.ruleId}-${occurrenceIndex}`} className="min-w-0 break-words">
                  <span className="font-mono break-all">{upstreamRuleId(occurrence.ruleId)}</span> - {occurrence.title}
                  {occurrence.detail !== null && (
                    <span className="block text-xs text-muted-foreground">{occurrence.detail}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  )
}

export function GenerateChecksPanel({ checks, pending }: { checks: GenerateCheck[]; pending: boolean }) {
  const errorChecks = checks.filter((check) => check.severity === 'error')
  const otherChecks = checks.filter((check) => check.severity !== 'error')

  return (
    <section data-testid="generate-checks" aria-labelledby="generate-checks-heading" className="mb-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
        <h3 id="generate-checks-heading" className="text-sm font-medium text-foreground">
          Checks
        </h3>
        {checks.length > 0 && <span className="text-xs text-muted-foreground">{countSummary(checks)}</span>}
      </div>
      {errorChecks.length > 0 && (
        <div role="alert" className="mb-2">
          <ul className="space-y-2">
            {errorChecks.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </ul>
        </div>
      )}
      {otherChecks.length > 0 && (
        <ul className="space-y-2">
          {otherChecks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </ul>
      )}
      {pending && <p className="mt-2 text-xs text-muted-foreground">Running checks...</p>}
      {!pending && checks.length === 0 && (
        <p className="text-xs text-muted-foreground">No issues found with this selection.</p>
      )}
    </section>
  )
}
