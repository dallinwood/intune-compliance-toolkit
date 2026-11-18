import { useMemo } from 'react'
import { cardCoverages } from '../logic/cardCoverage'
import { useSupportingChecksStore } from '../state/supportingChecksStore'
import { FrameworkCards } from '../components/frameworks/FrameworkCards'
import { FrameworkPage } from '../components/frameworks/FrameworkPage'
import { GenerateReviewScreen } from '../components/generate/GenerateReviewScreen'
import { resolveFrameworkPage } from '../logic/frameworkTabs'
import { useFilterStore } from '../state/filterStore'
import { ALL_FRAMEWORKS } from '../state/urlState'
import { useVocabularyIndex } from '../state/vocabularyContext'
import { termLabel } from '../logic/vocabulary'
import { useRuleMappings } from '../state/mappingsContext'
import type { ViewContext } from './viewContext'

export function FrameworksView(context: ViewContext) {
  const { sources, coveredVersions, isReviewingSelection, enabledSelections, onCloseReview } = context
  const framework = useFilterStore((state) => state.framework)
  const frameworkTab = useFilterStore((state) => state.frameworkTab)
  const { byRule, frameworkPairs } = useRuleMappings()
  const vocabularyIndex = useVocabularyIndex()
  const includeSupporting = useSupportingChecksStore((store) => store.includeSupporting)
  const overrides = useSupportingChecksStore((store) => store.overrides)
  const page = useMemo(() => resolveFrameworkPage(framework, frameworkTab, sources, frameworkPairs), [framework, frameworkTab, sources, frameworkPairs])

  const coverageBySource = useMemo(
    () =>
      cardCoverages(
        sources.map((source) => source.name),
        context.rows,
        byRule,
        frameworkPairs,
        { selectedRuleIds: new Set(enabledSelections.map((selection) => selection.ref.id)), automatedOnly: false, choices: { includeSupporting, overrides } },
      ),
    [sources, context.rows, byRule, frameworkPairs, enabledSelections, includeSupporting, overrides],
  )

  if (isReviewingSelection) {
    const backLabel =
      framework === null ? 'Back to frameworks' : framework === ALL_FRAMEWORKS ? 'Back to all rules' : `Back to ${termLabel(vocabularyIndex, 'sources', framework)}`
    return (
      <GenerateReviewScreen
        enabledEntries={enabledSelections}
        coveredVersions={coveredVersions}
        sources={sources}
        backLabel={backLabel}
        onBack={onCloseReview}
      />
    )
  }
  if (page === null) {
    return (
      <main className="flex-1 overflow-y-auto">
        <FrameworkCards sources={sources} coverageBySource={coverageBySource} />
      </main>
    )
  }
  return <FrameworkPage source={page.source} context={context} />
}
