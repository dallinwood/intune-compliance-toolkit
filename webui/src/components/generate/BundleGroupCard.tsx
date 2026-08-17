import type { Chunk } from '../../logic/chunking'

export function BundleGroupCard({ chunk }: { chunk: Chunk }) {
  const byteLength = new TextEncoder().encode(JSON.stringify(chunk.ruleEntries)).length
  const firstId = chunk.rules[0].id
  const lastId = chunk.rules[chunk.rules.length - 1].id
  const idRange = firstId === lastId ? firstId : `${firstId} – ${lastId}`

  return (
    <div className="rounded border border-slate-200 bg-white p-3 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-slate-700">
          {chunk.platform} · {chunk.family} {chunk.version} · {idRange}
          {chunk.partNumber !== null && ` (Part ${chunk.partNumber})`}
        </h3>
        <span className="text-xs text-slate-500">
          {chunk.rules.length} rule(s), {chunk.ruleEntries.length} setting(s), {(byteLength / 1024).toFixed(1)} KB
        </span>
      </div>
      <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
        {chunk.rules.map((rule) => (
          <li key={rule.id}>
            <span className="font-mono">{rule.id}</span> — {rule.title}
          </li>
        ))}
      </ul>
    </div>
  )
}
