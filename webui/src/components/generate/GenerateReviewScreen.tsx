import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { fetchRule } from '../../data/ruleDetail'
import { buildBundleFiles } from '../../logic/bundleFiles'
import {
  classifyRule,
  packChunks,
  type BlockedEntry,
  type Chunk,
  type GeneratableRule,
  type ManualAttestationEntry,
} from '../../logic/chunking'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import type { SelectionEntry } from '../../logic/selectionEntry'
import { buildZip } from '../../logic/zipBundle'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { ManifestSource } from '../../types/library'
import { BundleGroupCard } from './BundleGroupCard'
import { ManualAttestationReport } from './ManualAttestationReport'

type ReviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; scriptedCount: number; chunks: Chunk[]; manual: ManualAttestationEntry[]; blocked: BlockedEntry[] }

function byId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id)
}

function downloadZip(chunks: Chunk[], manual: ManualAttestationEntry[], sources: ManifestSource[]): void {
  const zipBytes = buildZip(buildBundleFiles(chunks, manual, sources))
  const url = URL.createObjectURL(new Blob([zipBytes as BlobPart], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `intune-toolkit-bundle-${new Date().toISOString().slice(0, 10)}.zip`
  link.click()
  // Revoking synchronously can cancel the download in some browsers before
  // it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// enabledEntries are the enabled selections whose rule is in the loaded
// library, each carrying the library's ref (partitionSelectionsByLibrary),
// so a saved selection for a rule the library no longer has never fails the
// whole review.
export function GenerateReviewScreen({
  enabledEntries,
  coveredVersions,
  sources,
  onBack,
}: {
  enabledEntries: SelectionEntry[]
  coveredVersions: string[]
  sources: ManifestSource[]
  onBack: () => void
}) {
  const [state, setState] = useState<ReviewState>({ status: 'loading' })
  const vocabularyIndex = useVocabularyIndex()

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    Promise.all(enabledEntries.map(async (entry) => ({ entry, rule: await fetchRule(entry.ref) })))
      .then((loaded) => {
        if (cancelled) return
        const generatable: GeneratableRule[] = []
        const manual: ManualAttestationEntry[] = []
        const blocked: BlockedEntry[] = []
        for (const { entry, rule } of loaded) {
          const result = classifyRule(rule, entry, coveredVersions, vocabularyIndex)
          if (result.kind === 'generatable') generatable.push(result.rule)
          else if (result.kind === 'manual') manual.push(result.entry)
          else blocked.push(result.entry)
        }
        // Packing waits until nothing is blocked: a chunk built before a
        // blocked rule is fixed would only be thrown away.
        const chunks = blocked.length === 0 ? packChunks(generatable, vocabularyIndex) : []
        setState({
          status: 'ready',
          scriptedCount: generatable.length,
          chunks,
          manual: manual.sort(byId),
          blocked: blocked.sort(byId),
        })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })

    return () => {
      cancelled = true
    }
  }, [enabledEntries, coveredVersions, vocabularyIndex])

  return (
    <div className="flex-1 overflow-y-auto p-4 text-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Review &amp; generate</h2>
        <button type="button" onClick={onBack} className="text-xs text-slate-500 underline hover:text-slate-700">
          Back to browse
        </button>
      </div>
      <ReviewBody enabledCount={enabledEntries.length} state={state} sources={sources} onBack={onBack} />
    </div>
  )
}

function ReviewBody({
  enabledCount,
  state,
  sources,
  onBack,
}: {
  enabledCount: number
  state: ReviewState
  sources: ManifestSource[]
  onBack: () => void
}) {
  if (enabledCount === 0) {
    return (
      <p className="text-slate-500">
        No rules selected.{' '}
        <button type="button" onClick={onBack} className="text-blue-600 underline">
          Go back and select some
        </button>
        .
      </p>
    )
  }
  if (state.status === 'loading') return <p className="text-slate-500">Loading selected rules…</p>
  if (state.status === 'error') return <p className="text-red-600">Could not prepare the bundle: {state.message}</p>

  const { scriptedCount, chunks, manual, blocked } = state

  return (
    <>
      {blocked.length > 0 && (
        <div role="alert" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <p className="mb-1 font-medium">Fix these before generating:</p>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            {blocked.map((entry) => (
              <li key={entry.id} className="break-words">
                <span className="font-mono break-all">{upstreamRuleId(entry.id)}</span> - {entry.title}: {entry.reason}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">Set a valid organization value in each rule's details on the browse screen.</p>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-slate-600">
        <span>{blocked.length > 0 ? 'Bundles are packed once nothing is blocked' : `${chunks.length} bundle(s)`}</span>
        <span>{scriptedCount} scripted rule(s)</span>
        <span>{manual.length} rule(s) need manual attestation</span>
        <Button
          type="button"
          size="sm"
          className="sm:ml-auto"
          onClick={() => downloadZip(chunks, manual, sources)}
          // A manual-only selection still downloads, as a zip holding just manual-attestation.md.
          disabled={blocked.length > 0 || (chunks.length === 0 && manual.length === 0)}
        >
          Download bundle (.zip)
        </Button>
      </div>

      {chunks.length > 0 && <DeploymentNote />}

      <div className="space-y-3">
        {chunks.map((chunk) => (
          <BundleGroupCard key={`${chunk.sourceName}-${chunk.releaseTag}-${chunk.section}-${chunk.partNumber ?? 0}`} chunk={chunk} />
        ))}
      </div>

      <ManualAttestationReport entries={manual} />
    </>
  )
}

function DeploymentNote() {
  return (
    <div className="mb-4 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
      <h3 className="mb-1 text-sm font-medium text-slate-800">Deploying in Intune</h3>
      <p>
        For each bundle, add its <span className="font-mono">-discovery.sh</span> under Endpoint security &gt; Device
        compliance &gt; Scripts (macOS) with "Run this script using the logged on credentials" set to No, because the
        checks assume root. Then create a custom compliance policy that uses that script and the matching{' '}
        <span className="font-mono">-rules.json</span>.
      </p>
      <p className="mt-1">
        A rule reports compliant without running its check on a macOS version it does not list, including versions
        older than this library covers, so pair these policies with Intune's minimum OS version compliance setting.
      </p>
    </div>
  )
}
