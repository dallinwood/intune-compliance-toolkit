import { ChevronLeft } from 'lucide-react'
import { useMemo, type MouseEvent } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { PageTitle } from '@/components/ui/page-title'
import { cn, isPlainLeftClick } from '@/lib/utils'
import { pluralize } from '../../lib/format'
import { frameworkHasPairs, resolveFrameworkTab } from '../../logic/frameworkTabs'
import { hrefForFrameworkPage, useFilterStore } from '../../state/filterStore'
import { useRuleMappings } from '../../state/mappingsContext'
import { ALL_FRAMEWORKS, type FrameworkTab } from '../../state/urlState'
import type { ManifestSource } from '../../types/library'
import { RulesView } from '../../views/RulesView'
import type { ViewContext } from '../../views/viewContext'
import { tabLinkClassName } from '../layout/tabLinkClassName'
import { FrameworkCoverageTab } from './FrameworkCoverageTab'
import { ReleaseComparisonView } from './ReleaseComparisonView'

const TAB_LABELS: Record<FrameworkTab, string> = { rules: 'Rules', releases: 'Releases', coverage: 'Coverage' }

function onPlainLeftClick(action: () => void) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainLeftClick(event)) return
    event.preventDefault()
    action()
  }
}

function SubTabs({ frameworkName, tabs, activeTab }: { frameworkName: string; tabs: FrameworkTab[]; activeTab: FrameworkTab }) {
  const filterState = useFilterStore()
  return (
    <nav aria-label="Page tabs" className="-mb-px">
      <ul className="flex flex-wrap gap-x-1">
        {tabs.map((tab) => {
          const isActive = tab === activeTab
          return (
            <li key={tab}>
              <a
                href={hrefForFrameworkPage(filterState, frameworkName, tab)}
                aria-current={isActive ? 'page' : undefined}
                onClick={onPlainLeftClick(() => {
                  if (!isActive) filterState.setFrameworkPage(frameworkName, tab)
                })}
                className={tabLinkClassName(isActive)}
              >
                {TAB_LABELS[tab]}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function BackToGridLink() {
  const filterState = useFilterStore()
  return (
    <a
      href={hrefForFrameworkPage(filterState, null, null)}
      onClick={onPlainLeftClick(() => filterState.setFrameworkPage(null, null))}
      className={cn(buttonVariants({ variant: 'link', size: 'sm' }), '-ml-3')}
    >
      <ChevronLeft aria-hidden="true" />
      All frameworks
    </a>
  )
}

// One framework's page (or the all-rules page): its header and sub-tabs, then
// the chosen sub-tab.
export function FrameworkPage({ source, context }: { source: ManifestSource | typeof ALL_FRAMEWORKS; context: ViewContext }) {
  const { rows, filteredRows, isStale, search, sources, filtersOpen, enabledSelections } = context
  const storedTab = useFilterStore((state) => state.frameworkTab)
  const { frameworkPairs } = useRuleMappings()
  const isAll = source === ALL_FRAMEWORKS
  const frameworkName = isAll ? ALL_FRAMEWORKS : source.name
  const hasCoverage = !isAll && frameworkHasPairs(frameworkPairs, source.name)
  const activeTab = resolveFrameworkTab(storedTab, isAll, hasCoverage)
  const tabs: FrameworkTab[] = isAll ? ['rules'] : hasCoverage ? ['rules', 'releases', 'coverage'] : ['rules', 'releases']
  const pageRows = useMemo(() => (isAll ? rows : rows.filter((row) => row.sourceName === frameworkName)), [isAll, rows, frameworkName])
  const enabledRuleIds = useMemo(() => new Set(enabledSelections.map((selection) => selection.ref.id)), [enabledSelections])

  const ruleCount = pluralize(pageRows.length, 'rule', 'rules')
  const currentRelease = isAll ? undefined : source.releases[source.releases.length - 1]
  const subtitle = currentRelease === undefined ? `${ruleCount} across every framework` : `Current release: ${currentRelease.label} (${currentRelease.tag}) · ${ruleCount}`

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border px-4 pt-2">
        <BackToGridLink />
        <PageTitle title={isAll ? 'All rules' : source.display_name} subtitle={subtitle} />
        <div className="mt-2">
          <SubTabs frameworkName={frameworkName} tabs={tabs} activeTab={activeTab} />
        </div>
      </div>
      {activeTab === 'rules' && (
        <RulesView rows={pageRows} filteredRows={filteredRows} isStale={isStale} search={search} filtersOpen={filtersOpen} hideSourceFacet={!isAll} />
      )}
      {activeTab === 'releases' && !isAll && (
        <ReleaseComparisonView sources={sources} source={source} enabledRuleIds={enabledRuleIds} filtersOpen={filtersOpen} />
      )}
      {activeTab === 'coverage' && !isAll && <FrameworkCoverageTab sourceName={source.name} rows={rows} selectedRuleIds={enabledRuleIds} />}
    </div>
  )
}
