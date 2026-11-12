import { useMemo } from 'react'
import { FrameworkCards } from '../components/frameworks/FrameworkCards'
import { ReleaseComparisonView } from '../components/frameworks/ReleaseComparisonView'
import { useFilterStore } from '../state/filterStore'
import type { ViewContext } from './viewContext'

export function FrameworksView({ sources, enabledSelections, filtersOpen }: Pick<ViewContext, 'sources' | 'enabledSelections' | 'filtersOpen'>) {
  const framework = useFilterStore((state) => state.framework)
  const enabledRuleIds = useMemo(() => new Set(enabledSelections.map((selection) => selection.ref.id)), [enabledSelections])
  const source = sources.find((candidate) => candidate.name === framework)

  if (source === undefined) {
    return (
      <main className="flex-1 overflow-y-auto">
        <FrameworkCards sources={sources} />
      </main>
    )
  }
  return <ReleaseComparisonView sources={sources} source={source} enabledRuleIds={enabledRuleIds} filtersOpen={filtersOpen} />
}
