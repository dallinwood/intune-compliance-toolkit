import { ChevronLeft } from 'lucide-react'
import { useId, useMemo, type MouseEvent, type ReactNode } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { PageTitle } from '@/components/ui/page-title'
import { ProvenanceBadge } from './ProvenanceBadge'
import { cn, isPlainLeftClick } from '@/lib/utils'
import { pluralize } from '../../lib/format'
import type { ResolvedFrameworkPage } from '../../logic/frameworkTabs'
import { hrefForFrameworkPage, useFilterStore } from '../../state/filterStore'
import { ALL_FRAMEWORKS, type FrameworkTab } from '../../state/urlState'
import type { ManifestRelease, ManifestSource } from '../../types/library'
import { RulesView } from '../../views/RulesView'
import type { ViewContext } from '../../views/viewContext'
import { tabLinkClassName } from '../layout/tabLinkClassName'
import { FrameworkCoverageTab } from './FrameworkCoverageTab'
import { SourceLine } from './SourceLine'
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
      className={cn(buttonVariants({ variant: 'link', size: 'sm' }), '-ml-3 h-6')}
    >
      <ChevronLeft aria-hidden="true" />
      All frameworks
    </a>
  )
}

// The manifest lists a framework's releases oldest first.
function currentReleaseOf(source: ManifestSource): ManifestRelease {
  return source.releases[source.releases.length - 1]
}

function releaseOptionLabel(release: ManifestRelease, isCurrent: boolean): string {
  return `${release.label} (${release.tag})${isCurrent ? ' (current)' : ''}`
}

// The release a framework's Rules sub-tab browses, newest first. Choosing the
// current release takes the parameter out of the address.
function ReleasePicker({ source, shownRelease, ruleCount }: { source: ManifestSource; shownRelease: ManifestRelease; ruleCount: string }) {
  const selectId = useId()
  const setRelease = useFilterStore((state) => state.setRelease)
  const currentRelease = currentReleaseOf(source)
  const newestFirst = useMemo(() => [...source.releases].reverse(), [source.releases])
  return (
    <>
      <label htmlFor={selectId}>Release</label>{' '}
      <NativeSelect
        id={selectId}
        value={shownRelease.tag}
        onChange={(event) => setRelease(event.target.value === currentRelease.tag ? null : event.target.value)}
        className="mx-1 h-7 max-w-full"
      >
        {newestFirst.map((release) => (
          <option key={release.tag} value={release.tag}>
            {releaseOptionLabel(release, release === currentRelease)}
          </option>
        ))}
      </NativeSelect>{' '}
      · {ruleCount}
    </>
  )
}

// One framework's page (or the all-rules page): its header and sub-tabs, then
// the chosen sub-tab.
export function FrameworkPage({ page, context }: { page: ResolvedFrameworkPage<ManifestSource>; context: ViewContext }) {
  const { rows, filteredRows, isStale, search, sources, filtersOpen, enabledSelections, olderRelease } = context
  const { source, tab: activeTab, hasCoverage } = page
  const isAll = source === ALL_FRAMEWORKS
  const frameworkName = isAll ? ALL_FRAMEWORKS : source.name
  const tabs: FrameworkTab[] = isAll ? ['rules'] : hasCoverage ? ['rules', 'releases', 'coverage'] : ['rules', 'releases']
  const currentReleaseRows = useMemo(() => (isAll ? rows : rows.filter((row) => row.sourceName === frameworkName)), [isAll, rows, frameworkName])
  const pageRows = olderRelease === null ? currentReleaseRows : olderRelease.status === 'ready' ? olderRelease.rows : []
  const enabledRuleIds = useMemo(() => new Set(enabledSelections.map((selection) => selection.ref.id)), [enabledSelections])

  // Until an older release's rows arrive, its count comes from the manifest.
  const ruleCount = pluralize(olderRelease !== null && olderRelease.status !== 'ready' ? olderRelease.release.rule_count : pageRows.length, 'rule', 'rules')
  let subtitle: ReactNode
  if (source === ALL_FRAMEWORKS) subtitle = `${ruleCount} across every framework`
  else if (activeTab === 'rules') subtitle = <ReleasePicker source={source} shownRelease={olderRelease?.release ?? currentReleaseOf(source)} ruleCount={ruleCount} />
  else subtitle = `Current release: ${currentReleaseOf(source).label} (${currentReleaseOf(source).tag}) · ${ruleCount}`

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border px-4 pt-0.5">
        <BackToGridLink />
        <PageTitle title={isAll ? 'All rules' : source.display_name} adornment={isAll ? undefined : <ProvenanceBadge provenance={source.provenance} />} subtitle={subtitle} />
        {!isAll && <div className="mt-1"><SourceLine source={source} /></div>}
        <div className="mt-1">
          <SubTabs frameworkName={frameworkName} tabs={tabs} activeTab={activeTab} />
        </div>
      </div>
      {activeTab === 'rules' && (
        <RulesView
          rows={pageRows}
          filteredRows={filteredRows}
          isStale={isStale}
          search={search}
          filtersOpen={filtersOpen}
          hideSourceFacet={!isAll}
          olderRelease={olderRelease}
        />
      )}
      {activeTab === 'releases' && !isAll && (
        <ReleaseComparisonView sources={sources} source={source} enabledRuleIds={enabledRuleIds} filtersOpen={filtersOpen} />
      )}
      {activeTab === 'coverage' && !isAll && <FrameworkCoverageTab sourceName={source.name} rows={rows} selectedRuleIds={enabledRuleIds} />}
    </div>
  )
}
