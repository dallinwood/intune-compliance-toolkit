import { useMemo } from 'react'
import { FrameworkCards } from '../components/frameworks/FrameworkCards'
import { FrameworkPage } from '../components/frameworks/FrameworkPage'
import { GenerateReviewScreen } from '../components/generate/GenerateReviewScreen'
import { resolveFrameworkPage } from '../logic/frameworkTabs'
import { useFilterStore } from '../state/filterStore'
import { useRuleMappings } from '../state/mappingsContext'
import type { ViewContext } from './viewContext'

export function FrameworksView(context: ViewContext) {
  const { sources, coveredVersions, isReviewingSelection, enabledSelections, onCloseReview } = context
  const framework = useFilterStore((state) => state.framework)
  const frameworkTab = useFilterStore((state) => state.frameworkTab)
  const { frameworkPairs } = useRuleMappings()
  const page = useMemo(() => resolveFrameworkPage(framework, frameworkTab, sources, frameworkPairs), [framework, frameworkTab, sources, frameworkPairs])

  if (isReviewingSelection) {
    return <GenerateReviewScreen enabledEntries={enabledSelections} coveredVersions={coveredVersions} sources={sources} onBack={onCloseReview} />
  }
  if (page === null) {
    return (
      <main className="flex-1 overflow-y-auto">
        <FrameworkCards sources={sources} />
      </main>
    )
  }
  return <FrameworkPage source={page.source} context={context} />
}
