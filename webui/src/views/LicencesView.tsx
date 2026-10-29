import { ChevronLeft } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { WarningsNotice } from '../components/layout/WarningsNotice'
import { LicenceCompare } from '../components/catalog/LicenceCompare'
import { LicenceDetail } from '../components/catalog/LicenceDetail'
import { LicenceList } from '../components/catalog/LicenceList'
import { useCatalogIndex } from '../hooks/useCatalogIndex'
import { buildCatalogLookup } from '../logic/inclusionDisplay'
import { useFilterStore } from '../state/filterStore'

const MINIMUM_COMPARED_LICENCES = 2

function Message({ children }: { children: string }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>
}

export function LicencesView() {
  const loadedCatalog = useCatalogIndex()
  const catalog = loadedCatalog?.index ?? null
  const licenceId = useFilterStore((state) => state.licence)
  const compareIds = useFilterStore((state) => state.compare)
  const setLicence = useFilterStore((state) => state.setLicence)
  const showLicenceFromComparison = useFilterStore((state) => state.showLicenceFromComparison)
  const setCompare = useFilterStore((state) => state.setCompare)
  const [isComparing, setIsComparing] = useState(compareIds.length > 0)
  // Below the lg breakpoint the list and the right pane take turns; this picks
  // the list while a comparison is being edited.
  const [isPickingComparison, setIsPickingComparison] = useState(false)
  // Back or forward into a comparison turns compare mode on.
  if (compareIds.length > 0 && !isComparing) setIsComparing(true)
  // Back past a comparison leaves compare mode; the store has followed the
  // address by the time this listener runs, because it registered first.
  useEffect(() => {
    function leaveCompareModeWhenHistoryEmptiesComparison() {
      if (useFilterStore.getState().compare.length === 0) setIsComparing(false)
    }
    window.addEventListener('popstate', leaveCompareModeWhenHistoryEmptiesComparison)
    return () => window.removeEventListener('popstate', leaveCompareModeWhenHistoryEmptiesComparison)
  }, [])
  const lookup = useMemo(() => (catalog === null ? null : buildCatalogLookup(catalog)), [catalog])

  if (loadedCatalog === null) {
    return (
      <main className="flex-1 overflow-y-auto">
        <Message>Loading the product and licence catalog…</Message>
      </main>
    )
  }
  if (catalog === null || lookup === null) {
    return (
      <main className="flex-1 overflow-y-auto">
        <WarningsNotice label="Catalog problems" summary="Some of the product and licence catalog could not be used:" warnings={loadedCatalog.warning === null ? [] : [loadedCatalog.warning]} />
        <Message>The product and licence catalog could not be loaded.</Message>
      </main>
    )
  }

  const licencesById = new Map(catalog.licences.map((licence) => [licence.id, licence]))
  const comparedLicences = compareIds.flatMap((id) => licencesById.get(id) ?? [])
  const isShowingComparison = isComparing && comparedLicences.length >= MINIMUM_COMPARED_LICENCES
  const selectedLicence = !isComparing && licenceId !== null ? (licencesById.get(licenceId) ?? null) : null
  const isRightPaneShown = selectedLicence !== null || (isShowingComparison && !isPickingComparison)

  function toggleCompareMode() {
    if (isComparing) setCompare([])
    setIsComparing(!isComparing)
    setIsPickingComparison(true)
  }

  function toggleCompared(toggledId: string) {
    setCompare(compareIds.includes(toggledId) ? compareIds.filter((id) => id !== toggledId) : [...compareIds, toggledId])
  }

  function openLicenceFromComparison(openedId: string) {
    setIsComparing(false)
    showLicenceFromComparison(openedId)
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <aside className={`${isRightPaneShown ? 'hidden lg:block' : 'block'} w-full shrink-0 overflow-y-auto border-border lg:w-80 lg:border-r`}>
        <LicenceList
          catalog={catalog}
          selectedLicenceId={licenceId}
          isComparing={isComparing}
          compareIds={compareIds}
          onToggleCompareMode={toggleCompareMode}
          onToggleCompared={toggleCompared}
          onShowComparison={() => setIsPickingComparison(false)}
        />
      </aside>
      <main className={`${isRightPaneShown ? 'flex' : 'hidden lg:flex'} min-w-0 flex-1 flex-col overflow-y-auto`}>
        <button
          type="button"
          onClick={() => (isComparing ? setIsPickingComparison(true) : setLicence(null))}
          className="flex items-center gap-1 px-4 pt-3 text-sm text-link hover:underline focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none lg:hidden"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          All licences
        </button>
        {isShowingComparison ? (
          <LicenceCompare licences={comparedLicences} catalog={catalog} lookup={lookup} onOpenLicence={openLicenceFromComparison} />
        ) : selectedLicence !== null ? (
          <LicenceDetail key={selectedLicence.id} licence={selectedLicence} catalog={catalog} lookup={lookup} />
        ) : (
          <Message>{isComparing ? 'Tick two or more licences to compare them.' : 'Select a licence to see what it includes.'}</Message>
        )}
      </main>
    </div>
  )
}
