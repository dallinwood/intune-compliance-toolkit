import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useFetchedRules } from '@/hooks/useFetchedRules'
import { loadCustomChangeStatus } from '../../data/customChanges'
import { fetchHistoryIndex } from '../../data/history'
import { buildBundleFiles } from '../../logic/bundleFiles'
import type { BlockedEntry, Chunk, ManualAttestationEntry } from '../../logic/chunking'
import {
  buildGenerateChecks,
  hasBlockingCheck,
  newestReleaseChange,
  type CustomChangeResult,
  type GenerateCheckInput,
} from '../../logic/generateChecks'
import { classifyReview, type PulledInOutcome } from '../../logic/generateReview'
import type { HistoryIndex } from '../../logic/historyIndex'
import { displayWithOdv } from '../../logic/odv'
import type { OverlayApplication } from '../../logic/overlays'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import type { SelectionEntry, SelectionMap } from '../../logic/selectionEntry'
import {
  includedSupportingRuleIds,
  supportingCheckOffers,
  type SupportingCheckChoices,
  type SupportingCheckOffer,
  type SupportingCheckOffers,
} from '../../logic/supportingChecks'
import {
  automatedSupportByControl,
  buildSupportingChecksMarkdown,
  type SupportingCheckReportEntry,
} from '../../logic/supportingChecksReport'
import { buildZip } from '../../logic/zipBundle'
import { termLabel, type VocabularyIndex } from '../../logic/vocabulary'
import { useRuleMappings } from '../../state/mappingsContext'
import { useSelectionStore } from '../../state/selectionStore'
import { useSupportingChecksStore } from '../../state/supportingChecksStore'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { ManifestSource, Rule } from '../../types/library'
import { BundleGroupCard } from './BundleGroupCard'
import { GenerateChecksPanel } from './GenerateChecksPanel'
import { ManualAttestationReport } from './ManualAttestationReport'
import { SupportingChecksPanel } from './SupportingChecksPanel'
import { pluralize } from '../../lib/format'
import { StatusMessage } from '@/components/ui/status-message'
import { BackLink } from '@/components/ui/back-link'
import { Card } from '@/components/ui/card'
import { PageTitle } from '@/components/ui/page-title'

interface ReadyReview {
  status: 'ready'
  scriptedCount: number
  chunks: Chunk[]
  manual: ManualAttestationEntry[]
  blocked: BlockedEntry[]
  // Rules whose custom content could not be applied, shown as imported.
  skippedCustomChanges: GenerateCheckInput['skippedCustomChanges'][number][]
  pulledIn: ReadonlyMap<string, PulledInOutcome>
  supportingChecksMarkdown: string | null
}

type ReviewState = { status: 'loading' } | { status: 'error'; message: string } | ReadyReview

// What the release checks read; changes only when the fetched selection does, so
// choosing or editing a supporting check never re-runs them.
interface ReleaseCheckInput {
  // Every selected rule, for the release checks.
  selectedRules: Rule[]
  // Custom changes written for a release other than the rule's current one.
  staleApplications: { rule: Rule; application: OverlayApplication }[]
}

type ReleaseChecksResult = Pick<GenerateCheckInput, 'customChanges' | 'newestReleaseChanges' | 'historyUnavailableSourceLabels'>

// Held with the input it was computed for, so a result for a previous
// selection is never shown as current.
interface LoadedReleaseChecks {
  forInput: ReleaseCheckInput
  result: ReleaseChecksResult
}

function downloadZip(
  chunks: Chunk[],
  manual: ManualAttestationEntry[],
  sources: ManifestSource[],
  supportingChecksMarkdown: string | null,
): void {
  const zipBytes = buildZip(buildBundleFiles(chunks, manual, sources, supportingChecksMarkdown))
  const url = URL.createObjectURL(new Blob([zipBytes as BlobPart], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `intune-toolkit-bundle-${new Date().toISOString().slice(0, 10)}.zip`
  link.click()
  // Revoking synchronously can cancel the download in some browsers before
  // it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function reportEntry(offer: SupportingCheckOffer, title: string): SupportingCheckReportEntry {
  return { ruleId: offer.ruleId, title, supports: offer.supports, depth: offer.depth }
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
  const vocabularyIndex = useVocabularyIndex()
  const { byRule, rowsById } = useRuleMappings()
  const selections = useSelectionStore((store) => store.selections)
  const includeSupporting = useSupportingChecksStore((store) => store.includeSupporting)
  const overrides = useSupportingChecksStore((store) => store.overrides)
  const pruneSupportingChoices = useSupportingChecksStore((store) => store.prune)
  const choices = useMemo<SupportingCheckChoices>(() => ({ includeSupporting, overrides }), [includeSupporting, overrides])

  // Keyed by the ids, so editing a value (which replaces enabledEntries) does not redo the offers.
  const selectedIdsKey = enabledEntries
    .map((entry) => entry.ref.id)
    .sort()
    .join('\n')
  const selectedRuleIds = useMemo(() => new Set(selectedIdsKey === '' ? [] : selectedIdsKey.split('\n')), [selectedIdsKey])
  const offers = useMemo(() => supportingCheckOffers(rowsById, byRule, selectedRuleIds), [rowsById, byRule, selectedRuleIds])
  const allOffers = useMemo(() => [...offers.direct, ...offers.throughOtherRules], [offers])
  const includedIds = useMemo(() => includedSupportingRuleIds(offers, choices), [offers, choices])

  // An empty mapping index means mappings failed to load, not that nothing is offered.
  useEffect(() => {
    if (byRule.size > 0) pruneSupportingChoices(offers)
  }, [offers, byRule, pruneSupportingChoices])

  const selectedFetch = useFetchedRules(
    enabledEntries.map((entry) => entry.ref),
    true,
  )
  const offeredRefs = allOffers.flatMap((offer) => {
    const row = rowsById.get(offer.ruleId)
    return row === undefined ? [] : [row.ref]
  })
  const offeredFetch = useFetchedRules(offeredRefs, includeSupporting && offeredRefs.length > 0)
  const supportingLoading = includeSupporting && offeredRefs.length > 0 && offeredFetch.status === 'loading'

  const fetchedOfferedRules = useMemo(
    () => new Map(offeredFetch.status === 'ready' ? [...offeredFetch.rulesById].map(([ruleId, fetched]) => [ruleId, fetched.rule]) : []),
    [offeredFetch],
  )

  const releaseCheckInput = useMemo<ReleaseCheckInput | null>(() => {
    if (selectedFetch.status !== 'ready') return null
    const fetchedRules = [...selectedFetch.rulesById.values()]
    return {
      selectedRules: fetchedRules.map(({ rule }) => rule),
      staleApplications: fetchedRules.flatMap(({ rule, overlaid }) =>
        overlaid.applied.filter((application) => application.stale).map((application) => ({ rule, application })),
      ),
    }
  }, [selectedFetch])

  const review = useMemo<ReviewState>(() => {
    if (selectedFetch.status === 'error') return { status: 'error', message: selectedFetch.message }
    if (offeredFetch.status === 'error') return { status: 'error', message: offeredFetch.message }
    if (selectedFetch.status !== 'ready') return { status: 'loading' }

    const selected = enabledEntries.flatMap((entry) => {
      const fetched = selectedFetch.rulesById.get(entry.ref.id)
      return fetched === undefined ? [] : [{ entry, rule: fetched.rule }]
    })
    const includedSupporting =
      offeredFetch.status === 'ready'
        ? includedIds.flatMap((ruleId) => {
            const fetched = offeredFetch.rulesById.get(ruleId)
            return fetched === undefined ? [] : [{ ref: fetched.ref, rule: fetched.rule }]
          })
        : []
    const classification = classifyReview({ selected, includedSupporting, selections, coveredVersions, vocabularyIndex })

    const scriptedSupportingIds = new Set(
      [...classification.pulledIn].filter(([, outcome]) => outcome.kind === 'generatable').map(([ruleId]) => ruleId),
    )
    const selectedAutomatedRuleIds = new Set(
      enabledEntries.filter((entry) => rowsById.get(entry.ref.id)?.assessment.status === 'automated').map((entry) => entry.ref.id),
    )
    const supportByControl = automatedSupportByControl(offers, scriptedSupportingIds, selectedAutomatedRuleIds, byRule)

    const includedEntries = allOffers
      .filter((offer) => scriptedSupportingIds.has(offer.ruleId))
      .map((offer) => reportEntry(offer, classification.pulledIn.get(offer.ruleId)?.title ?? offer.ruleId))
    const excludedEntries = includeSupporting
      ? allOffers
          .filter((offer) => !includedIds.includes(offer.ruleId))
          .map((offer) => reportEntry(offer, displayWithOdv(rowsById.get(offer.ruleId)?.title ?? offer.ruleId, null)))
      : []

    const skippedCustomChanges: ReadyReview['skippedCustomChanges'] = []
    for (const { entry, rule } of selected) {
      const skipped = selectedFetch.rulesById.get(entry.ref.id)?.overlaid.skipped ?? []
      if (skipped.length > 0) skippedCustomChanges.push({ ruleId: entry.ref.id, title: rule.title, skipped })
    }

    return {
      status: 'ready',
      scriptedCount: classification.scriptedCount,
      chunks: classification.chunks,
      manual: classification.manual.map((entry) => ({ ...entry, automatedSupportRuleIds: supportByControl.get(entry.id) ?? [] })),
      blocked: classification.blocked,
      skippedCustomChanges,
      pulledIn: classification.pulledIn,
      supportingChecksMarkdown:
        includedEntries.length === 0 ? null : buildSupportingChecksMarkdown(includedEntries, excludedEntries, upstreamRuleId),
    }
  }, [
    selectedFetch,
    offeredFetch,
    enabledEntries,
    includedIds,
    selections,
    coveredVersions,
    vocabularyIndex,
    offers,
    allOffers,
    byRule,
    rowsById,
    includeSupporting,
  ])

  const [loadedReleaseChecks, setLoadedReleaseChecks] = useState<LoadedReleaseChecks | null>(null)

  useEffect(() => {
    if (releaseCheckInput === null) return
    let cancelled = false
    loadReleaseChecks(releaseCheckInput, sources, vocabularyIndex).then((result) => {
      if (!cancelled) setLoadedReleaseChecks({ forInput: releaseCheckInput, result })
    })
    return () => {
      cancelled = true
    }
  }, [releaseCheckInput, sources, vocabularyIndex])

  const releaseChecks =
    loadedReleaseChecks !== null && loadedReleaseChecks.forInput === releaseCheckInput ? loadedReleaseChecks.result : null

  const selectedManualControlCount = enabledEntries.filter((entry) => rowsById.get(entry.ref.id)?.assessment.status === 'manual').length

  return (
    <div className="flex-1 overflow-y-auto p-4 text-sm">
      <div className="mb-4">
        <PageTitle title="Review & generate" actions={<BackLink onClick={onBack}>Back to rules</BackLink>} />
      </div>
      <ReviewBody
        enabledCount={enabledEntries.length}
        state={review}
        releaseChecks={releaseChecks}
        sources={sources}
        onBack={onBack}
        supportingChecks={{
          offers,
          choices,
          includedRuleIds: new Set(includedIds),
          loading: supportingLoading,
          fetchedRules: fetchedOfferedRules,
          selections,
          selectedManualControlCount,
        }}
      />
    </div>
  )
}

// Never rejects: a failed history or comparison load becomes a check result,
// so it can neither fail the review nor block the download.
async function loadReleaseChecks(
  state: ReleaseCheckInput,
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

interface SupportingChecksView {
  offers: SupportingCheckOffers
  choices: SupportingCheckChoices
  includedRuleIds: ReadonlySet<string>
  loading: boolean
  fetchedRules: ReadonlyMap<string, Rule>
  selections: SelectionMap
  selectedManualControlCount: number
}

function ReviewBody({
  enabledCount,
  state,
  releaseChecks,
  sources,
  onBack,
  supportingChecks,
}: {
  enabledCount: number
  state: ReviewState
  releaseChecks: ReleaseChecksResult | null
  sources: ManifestSource[]
  onBack: () => void
  supportingChecks: SupportingChecksView
}) {
  const { rowsById } = useRuleMappings()
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
  if (state.status === 'loading') return <StatusMessage isLoading className="p-0">Loading selected rules…</StatusMessage>
  if (state.status === 'error') return <p className="text-destructive">Could not prepare the bundle: {state.message}</p>

  const { scriptedCount, chunks, manual, skippedCustomChanges, blocked, pulledIn, supportingChecksMarkdown } = state
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

      {supportingChecks.offers.direct.length + supportingChecks.offers.throughOtherRules.length > 0 && (
        <SupportingChecksPanel
          offers={supportingChecks.offers}
          selectedManualControlCount={supportingChecks.selectedManualControlCount}
          rowsById={rowsById}
          choices={supportingChecks.choices}
          includedRuleIds={supportingChecks.includedRuleIds}
          loading={supportingChecks.loading}
          outcomes={pulledIn}
          fetchedRules={supportingChecks.fetchedRules}
          selections={supportingChecks.selections}
        />
      )}

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-foreground/80">
        <span>{hasBlockingCheck(checks) ? 'Bundles are packed once nothing is blocked' : pluralize(chunks.length, 'bundle', 'bundles')}</span>
        <span>{pluralize(scriptedCount, 'scripted rule', 'scripted rules')}</span>
        <span>{pluralize(manual.length, 'rule needs', 'rules need')} manual attestation</span>
        <Button
          type="button"
          size="sm"
          className="sm:ml-auto"
          onClick={() => downloadZip(chunks, manual, sources, supportingChecksMarkdown)}
          // A manual-only selection still downloads, as a zip holding just manual-attestation.md.
          disabled={supportingChecks.loading || hasBlockingCheck(checks) || (chunks.length === 0 && manual.length === 0)}
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
    <Card className="mb-4 text-xs text-foreground/80">
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
    </Card>
  )
}
