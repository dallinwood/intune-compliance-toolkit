import { bundleBaseName, serializeRulesJson } from '../../logic/bundleFiles'
import type { Chunk } from '../../logic/chunking'
import { sectionLabel, upstreamRuleId } from '../../logic/ruleDisplay'

export function BundleGroupCard({ chunk }: { chunk: Chunk }) {
  const rulesJsonBytes = new TextEncoder().encode(serializeRulesJson(chunk.ruleEntries)).length
  const baseName = bundleBaseName(chunk)

  return (
    <section className="rounded border border-slate-200 bg-white p-3 text-sm" aria-label={`Bundle ${baseName}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-medium text-slate-800">
          {sectionLabel(chunk.section)}
          {chunk.partNumber !== null && `, part ${chunk.partNumber}`}
          <span className="font-normal text-slate-500">
            {' '}
            ({chunk.sourceName} {chunk.releaseTag})
          </span>
        </h3>
        <span className="text-xs text-slate-500">
          {chunk.rules.length} rule(s), {(rulesJsonBytes / 1024).toFixed(1)} KB of rules JSON
        </span>
      </div>
      <ul className="mt-1 font-mono text-xs break-all text-slate-500" aria-label="Files">
        <li>{baseName}-discovery.sh</li>
        <li>{baseName}-rules.json</li>
      </ul>
      <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
        {chunk.rules.map((rule) => (
          <li key={rule.id} className="break-words">
            <span className="font-mono break-all">{upstreamRuleId(rule.id)}</span> - {rule.title}
          </li>
        ))}
      </ul>
    </section>
  )
}
