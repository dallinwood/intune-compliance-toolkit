import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { fetchReferencedText } from '../../data/referencedFiles'
import { fetchOverlaidRule } from '../../data/ruleDetail'
import { buildBundleFiles } from '../../logic/bundleFiles'
import {
  classifyRule,
  packChunks,
  type BlockedEntry,
  type Chunk,
  type GeneratableRule,
  type ManualAttestationEntry,
} from '../../logic/chunking'
import { resolveGeneratedCheckFiles } from '../../logic/fileReferences'
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
  | {
      status: 'ready'
      scriptedCount: number
      chunks: Chunk[]
      manual: ManualAttestationEntry[]
      blocked: BlockedEntry[]
      // Rules whose custom content could not be applied, shown as imported.
      overlayIssueRuleIds: string[]
    }

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

    // The macOS check's script files are resolved before classifying, so the
    // bundle holds exactly what an inline script would give.
    Promise.all(
      enabledEntries.map(async (entry) => {
        const overlaid = await fetchOverlaidRule(entry.ref)
        return {
          entry,
          rule: await resolveGeneratedCheckFiles(overlaid.rule, fetchReferencedText),
          hasOverlayIssue: overlaid.skipped.length > 0,
        }
      }),
    )
      .then((loaded) => {
        if (cancelled) return
        const generatable: GeneratableRule[] = []
        const manual: ManualAttestationEntry[] = []
        const blocked: BlockedEntry[] = []
        const overlayIssueRuleIds: string[] = []
        for (const { entry, rule, hasOverlayIssue } of loaded) {
          if (hasOverlayIssue) overlayIssueRuleIds.push(entry.ref.id)
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
          overlayIssueRuleIds: overlayIssueRuleIds.sort(),
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
        <h2 className="text-lg font-semibold text-foreground">Review &amp; generate</h2>
        <button type="button" onClick={onBack} className="text-xs text-muted-foreground underline hover:text-foreground">
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
      <p className="text-muted-foreground">
        No rules selected.{' '}
        <button type="button" onClick={onBack} className="text-link underline">
          Go back and select some
        </button>
        .
      </p>
    )
  }
  if (state.status === 'loading') return <p className="text-muted-foreground">Loading selected rules…</p>
  if (state.status === 'error') return <p className="text-destructive">Could not prepare the bundle: {state.message}</p>

  const { scriptedCount, chunks, manual, blocked, overlayIssueRuleIds } = state

  return (
    <>
      {overlayIssueRuleIds.length > 0 && (
        <p data-testid="overlay-issues-note" className="mb-4 text-xs break-words text-warning-foreground">
          Custom content for {overlayIssueRuleIds.length} rule(s) could not be applied; they are shown as imported:{' '}
          {overlayIssueRuleIds.map(upstreamRuleId).join(', ')}.
        </p>
      )}
      {blocked.length > 0 && (
        <div role="alert" className="mb-4 rounded border border-warning-border bg-warning p-3 text-warning-foreground">
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

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-foreground/80">
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
    <div className="mb-4 rounded border border-border bg-panel p-3 text-xs text-foreground/80">
      <h3 className="mb-1 text-sm font-medium text-foreground">Deploying in Intune</h3>
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
