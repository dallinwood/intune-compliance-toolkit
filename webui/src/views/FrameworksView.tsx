import { FrameworkCards } from '../components/frameworks/FrameworkCards'
import { useFilterStore } from '../state/filterStore'
import type { ViewContext } from './viewContext'

export function FrameworksView({ sources }: Pick<ViewContext, 'sources'>) {
  const framework = useFilterStore((state) => state.framework)
  const compareFrom = useFilterStore((state) => state.compareFrom)
  const compareTo = useFilterStore((state) => state.compareTo)
  const closeComparison = useFilterStore((state) => state.closeComparison)
  const source = sources.find((candidate) => candidate.name === framework)

  if (source === undefined) {
    return (
      <main className="flex-1 overflow-y-auto">
        <FrameworkCards sources={sources} />
      </main>
    )
  }
  return (
    <main className="flex-1 overflow-y-auto p-4">
      <button type="button" onClick={closeComparison} className="text-sm text-link underline">
        All frameworks
      </button>
      <p className="mt-2 text-sm">
        {source.display_name}: {compareFrom} to {compareTo}
      </p>
    </main>
  )
}
