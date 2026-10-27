import { parseCatalogIndex } from '../logic/catalogIndex'
import type { CatalogIndex } from '../types/catalog'
import { describeError, fetchJson } from './fetchJson'

const INDEX_PATH = 'catalog/_index.json'

export interface LoadedCatalogIndex {
  index: CatalogIndex | null
  warning: string | null
}

function noCatalog(problem: string): LoadedCatalogIndex {
  return { index: null, warning: `The product and licence catalog could not be loaded (${INDEX_PATH}: ${problem}).` }
}

// Never rejects: the catalog is an addition, so any failure leaves the rest
// of the app usable with a warning.
export async function loadCatalogIndex(): Promise<LoadedCatalogIndex> {
  try {
    const file = await fetchJson(INDEX_PATH)
    if ('problem' in file) return noCatalog(file.problem)
    const parsed = parseCatalogIndex(file.value)
    if (typeof parsed === 'string') return noCatalog(parsed)
    return { index: parsed, warning: null }
  } catch (error) {
    return noCatalog(describeError(error))
  }
}
