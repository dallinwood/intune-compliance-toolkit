import { bundleBaseName, serializeRulesJson } from '../../logic/bundleFiles'
import type { Chunk } from '../../logic/chunking'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { termLabel } from '../../logic/vocabulary'
import { useVocabularyIndex } from '../../state/vocabularyContext'

export function BundleGroupCard({ chunk }: { chunk: Chunk }) {
  const index = useVocabularyIndex()
  const rulesJsonBytes = new TextEncoder().encode(serializeRulesJson(chunk.ruleEntries)).length
  const baseName = bundleBaseName(chunk)

  return (
    <section className="rounded border border-border bg-card p-3 text-sm" aria-label={`Bundle ${baseName}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-medium text-foreground">
          {termLabel(index, 'sections', chunk.section)}
          {chunk.partNumber !== null && `, part ${chunk.partNumber}`}
          <span className="font-normal text-muted-foreground">
            {' '}
            ({chunk.sourceName} {chunk.releaseTag})
          </span>
        </h3>
        <span className="text-xs text-muted-foreground">
          {chunk.rules.length} rule(s), {(rulesJsonBytes / 1024).toFixed(1)} KB of rules JSON
        </span>
      </div>
      <ul className="mt-1 font-mono text-xs break-all text-muted-foreground" aria-label="Files">
        <li>{baseName}-discovery.sh</li>
        <li>{baseName}-rules.json</li>
      </ul>
      <ul className="mt-2 space-y-0.5 text-xs text-foreground/80">
        {chunk.rules.map((rule) => (
          <li key={rule.id} className="break-words">
            <span className="font-mono break-all">{upstreamRuleId(rule.id)}</span> - {rule.title}
          </li>
        ))}
      </ul>
    </section>
  )
}
