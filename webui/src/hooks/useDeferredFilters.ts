import { useDeferredValue, useMemo } from 'react'
import type { FilterValues } from '../logic/ruleFilters'
import { useFilterStore } from '../state/filterStore'

export function useDeferredFilters(): { filters: FilterValues; isStale: boolean } {
  const search = useFilterStore((state) => state.search)
  const targets = useFilterStore((state) => state.targets)
  const sources = useFilterStore((state) => state.sources)
  const versions = useFilterStore((state) => state.versions)
  const benchmarks = useFilterStore((state) => state.benchmarks)
  const sections = useFilterStore((state) => state.sections)
  const tags = useFilterStore((state) => state.tags)
  const linked = useFilterStore((state) => state.linked)
  const checks = useFilterStore((state) => state.checks)
  const remediations = useFilterStore((state) => state.remediations)
  const odvs = useFilterStore((state) => state.odvs)
  const automatable = useFilterStore((state) => state.automatable)

  const currentFilters = useMemo<FilterValues>(
    () => ({ search, targets, sources, versions, benchmarks, sections, tags, linked, checks, remediations, odvs, automatable }),
    [search, targets, sources, versions, benchmarks, sections, tags, linked, checks, remediations, odvs, automatable],
  )
  const deferredFilters = useDeferredValue(currentFilters)

  return { filters: deferredFilters, isStale: deferredFilters !== currentFilters }
}
