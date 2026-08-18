import { useEffect, useMemo, useState } from 'react'
import { buildBundleFiles } from '../../logic/bundleFiles'
import { classifyRule, packChunks, type BlockedEntry, type Chunk, type GeneratableRule, type ManualAttestationEntry } from '../../logic/chunking'
import { buildZip } from '../../logic/zipBundle'
import { fetchRuleDetail } from '../../data/ruleDetail'
import { useSelectionStore } from '../../state/selectionStore'
import { BundleGroupCard } from './BundleGroupCard'
import { ManualAttestationReport } from './ManualAttestationReport'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; chunks: Chunk[]; manual: ManualAttestationEntry[]; blocked: BlockedEntry[] }

export function GenerateReviewScreen({ onBack }: { onBack: () => void }) {
  const selections = useSelectionStore((store) => store.selections)
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  const enabledEntries = useMemo(() => Object.values(selections).filter((entry) => entry.enabled), [selections])

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    Promise.all(enabledEntries.map((entry) => fetchRuleDetail(entry.ref).then((rule) => ({ entry, rule }))))
      .then((loaded) => {
        if (cancelled) return

        const manual: ManualAttestationEntry[] = []
        const blocked: BlockedEntry[] = []
        const generatable: GeneratableRule[] = []

        for (const { entry, rule } of loaded) {
          const result = classifyRule(entry.ref, rule, entry)
          if (result.kind === 'manual') manual.push(result.entry)
          else if (result.kind === 'blocked') blocked.push(result.entry)
          else generatable.push(result.rule)
        }

        // Packing (and therefore the whole review) is deferred until every
        // blocking issue is resolved - a chunk built around a rule that
        // might still change shape isn't worth computing.
        const chunks = blocked.length === 0 ? packChunks(generatable) : []
        setState({ status: 'ready', chunks, manual, blocked })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })

    return () => {
      cancelled = true
    }
    // enabledEntries is derived from selections every render; depending on
    // selections directly avoids re-running this effect twice per change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selections])

  if (enabledEntries.length === 0) {
    return (
      <div className="p-8 text-sm text-slate-500">
        No rules selected.{' '}
        <button type="button" onClick={onBack} className="text-blue-600 underline">
          Go back and select some
        </button>
        .
      </div>
    )
  }

  if (state.status === 'loading') {
    return <div className="p-8 text-sm text-slate-500">Loading selected rules…</div>
  }
  if (state.status === 'error') {
    return <div className="p-8 text-sm text-red-600">Failed to load selected rules: {state.message}</div>
  }

  const { chunks, manual, blocked } = state
  const totalSettings = chunks.reduce((sum, chunk) => sum + chunk.ruleEntries.length, 0)

  function handleDownload() {
    const files = buildBundleFiles(chunks, manual)
    const zipBytes = buildZip(files)
    const blob = new Blob([zipBytes as BlobPart], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `intune-toolkit-bundle-${new Date().toISOString().slice(0, 10)}.zip`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 text-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Review &amp; generate</h2>
        <button type="button" onClick={onBack} className="text-xs text-slate-500 underline hover:text-slate-700">
          Back to browse
        </button>
      </div>

      {blocked.length > 0 && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-amber-800">
          <p className="mb-1 font-medium">Fix these before generating:</p>
          <ul className="list-disc pl-5 text-xs">
            {blocked.map((entry) => (
              <li key={entry.ref.id}>
                <span className="font-mono">{entry.id}</span> — {entry.title}: needs a value for{' '}
                {entry.missingVariables.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-4 text-slate-600">
        <span>{chunks.length} bundle(s)</span>
        <span>{totalSettings} setting(s) total</span>
        <span>{manual.length} rule(s) need manual attestation</span>
        <button
          type="button"
          onClick={handleDownload}
          disabled={blocked.length > 0 || chunks.length === 0}
          className="ml-auto rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Download bundle (.zip)
        </button>
      </div>

      <div className="space-y-3">
        {chunks.map((chunk) => (
          <BundleGroupCard
            key={`${chunk.platform}-${chunk.product}-${chunk.version}-${chunk.section}-${chunk.partNumber ?? 0}`}
            chunk={chunk}
          />
        ))}
      </div>

      <ManualAttestationReport entries={manual} />
    </div>
  )
}
