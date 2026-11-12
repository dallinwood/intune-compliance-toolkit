import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { loadCustomChangeStatus } from '../../data/customChanges'
import { fetchHistoryIndex } from '../../data/history'
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
import {
  buildGenerateChecks,
  hasBlockingCheck,
  newestReleaseChange,
  type CustomChangeResult,
  type GenerateCheckInput,
} from '../../logic/generateChecks'
import type { HistoryIndex } from '../../logic/historyIndex'
import type { OverlayApplication } from '../../logic/overlays'
import type { SelectionEntry } from '../../logic/selectionEntry'
import { buildZip } from '../../logic/zipBundle'
import { termLabel, type VocabularyIndex } from '../../logic/vocabulary'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { ManifestSource, Rule } from '../../types/library'
import { BundleGroupCard } from './BundleGroupCard'
import { GenerateChecksPanel } from './GenerateChecksPanel'
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
      // Every selected rule, for the release checks.
      selectedRules: Rule[]
      // Rules whose custom content could not be applied, shown as imported.
      skippedCustomChanges: GenerateCheckInput['skippedCustomChanges'][number][]
      // Custom changes written for a release other than the rule's current one.
      staleApplications: { rule: Rule; application: OverlayApplication }[]
    }

type ReadyReviewState = Extract<ReviewState, { status: 'ready' }>

type ReleaseChecksResult = Pick<GenerateCheckInput, 'customChanges' | 'newestReleaseChanges' | 'historyUnavailableSourceLabels'>

// Held with the review it was computed for, so a result for a previous
// selection is never shown as current.
interface LoadedReleaseChecks {
  forState: ReviewState
  result: ReleaseChecksResult
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
          overlaid,
        }
      }),
    )
      .then((loaded) => {
        if (cancelled) return
        const generatable: GeneratableRule[] = []
        const manual: ManualAttestationEntry[] = []
        const blocked: BlockedEntry[] = []
        const skippedCustomChanges: ReadyReviewState['skippedCustomChanges'] = []
        const staleApplications: ReadyReviewState['staleApplications'] = []
        for (const { entry, rule, overlaid } of loaded) {
          if (overlaid.skipped.length > 0) {
            skippedCustomChanges.push({ ruleId: entry.ref.id, title: rule.title, skipped: overlaid.skipped })
          }
          for (const application of overlaid.applied) {
            if (application.stale) staleApplications.push({ rule, application })
          }
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
          selectedRules: loaded.map(({ rule }) => rule),
          skippedCustomChanges,
          staleApplications,
        })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })

    return () => {
      cancelled = true
    }
  }, [enabledEntries, coveredVersions, vocabularyIndex])

  const [loadedReleaseChecks, setLoadedReleaseChecks] = useState<LoadedReleaseChecks | null>(null)

  useEffect(() => {
    if (state.status !== 'ready') return
    let cancelled = false
    loadReleaseChecks(state, sources, vocabularyIndex).then((result) => {
      if (!cancelled) setLoadedReleaseChecks({ forState: state, result })
    })
    return () => {
      cancelled = true
    }
  }, [state, sources, vocabularyIndex])

  const releaseChecks =
    loadedReleaseChecks !== null && loadedReleaseChecks.forState === state ? loadedReleaseChecks.result : null

  return (
    <div className="flex-1 overflow-y-auto p-4 text-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-foreground">Review &amp; generate</h2>
        <button type="button" onClick={onBack} className="text-xs text-muted-foreground underline hover:text-foreground">
          Back to browse
        </button>
      </div>
      <ReviewBody
        enabledCount={enabledEntries.length}
        state={state}
        releaseChecks={releaseChecks}
        sources={sources}
        onBack={onBack}
      />
    </div>
  )
}

// Never rejects: a failed history or comparison load becomes a check result,
// so it can neither fail the review nor block the download.
async function loadReleaseChecks(
  state: ReadyReviewState,
  sources: ManifestSource[],
  vocabularyIndex: VocabularyIndex,
): Promise<ReleaseChecksResult> {
  const sourceNamesWithHistory = [...new Set(state.selectedRules.map((rule) => rule.source.name))].filter(
    (sourceName) => (sources.find((source) => source.name === sourceName)?.releases.length ?? 0) >= 2,
  )

  const [historySettlements, comparisonSettlements] = await Promise.all([
    Promise.allSettled(sourceNamesWithHistory.map((sourceName) => fetchHistoryIndex(sourceName))),
    Promise.allSettled(
      state.staleApplications.map(({ rule, application }) => loadCustomChangeStatus(rule, application, vocabularyIndex)),
    ),
  ])

  const historyUnavailableSourceLabels: string[] = []
  const historyBySource = new Map<string, HistoryIndex>()
  historySettlements.forEach((settlement, position) => {
    const sourceName = sourceNamesWithHistory[position]
    if (settlement.status === 'fulfilled') historyBySource.set(sourceName, settlement.value)
    else historyUnavailableSourceLabels.push(termLabel(vocabularyIndex, 'sources', sourceName))
  })

  const newestReleaseChanges: GenerateCheckInput['newestReleaseChanges'][number][] = []
  for (const rule of state.selectedRules) {
    const history = historyBySource.get(rule.source.name)
    if (history === undefined) continue
    // The history index is keyed by the full rule id, the same as rule.id.
    const change = newestReleaseChange(history, rule.id)
    if (change !== null) newestReleaseChanges.push({ ruleId: rule.id, title: rule.title, change })
  }

  const customChanges: ReleaseChecksResult['customChanges'] = state.staleApplications.map(({ rule, application }, position) => {
    const settlement = comparisonSettlements[position]
    const result: CustomChangeResult =
      settlement.status === 'fulfilled'
        ? { kind: 'compared', status: settlement.value.status, releaseLabel: settlement.value.releaseLabel }
        : { kind: 'unknown', release: application.release }
    return { ruleId: rule.id, title: rule.title, result }
  })

  return { customChanges, newestReleaseChanges, historyUnavailableSourceLabels: historyUnavailableSourceLabels.sort() }
}

function ReviewBody({
  enabledCount,
  state,
  releaseChecks,
  sources,
  onBack,
}: {
  enabledCount: number
  state: ReviewState
  releaseChecks: ReleaseChecksResult | null
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

  const { scriptedCount, chunks, manual, skippedCustomChanges, blocked } = state
  const checks = buildGenerateChecks({
    blocked,
    skippedCustomChanges,
    customChanges: releaseChecks?.customChanges ?? [],
    newestReleaseChanges: releaseChecks?.newestReleaseChanges ?? [],
    historyUnavailableSourceLabels: releaseChecks?.historyUnavailableSourceLabels ?? [],
  })

  return (
    <>
      <GenerateChecksPanel checks={checks} pending={releaseChecks === null} />

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-foreground/80">
        <span>{hasBlockingCheck(checks) ? 'Bundles are packed once nothing is blocked' : `${chunks.length} bundle(s)`}</span>
        <span>{scriptedCount} scripted rule(s)</span>
        <span>{manual.length} rule(s) need manual attestation</span>
        <Button
          type="button"
          size="sm"
          className="sm:ml-auto"
          onClick={() => downloadZip(chunks, manual, sources)}
          // A manual-only selection still downloads, as a zip holding just manual-attestation.md.
          disabled={hasBlockingCheck(checks) || (chunks.length === 0 && manual.length === 0)}
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
