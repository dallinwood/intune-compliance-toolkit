import type { ProductLicenceEntry } from '../types/catalog'
import { compareText } from './catalogIndex'

export interface LicenceRow {
  licence: string
  // The licences, contained by this one, that bring the product in; empty
  // when the licence only lists the product itself.
  supplyingLicenceIds: string[]
  notes: string[]
}

function appendOnce(values: string[], value: string | null | undefined) {
  if (value !== null && value !== undefined && !values.includes(value)) values.push(value)
}

// One row per licence, however many routes bring the product in, ordered by licence id.
export function groupLicenceEntries(entries: ProductLicenceEntry[]): LicenceRow[] {
  const rowsByLicence = new Map<string, LicenceRow>()
  for (const entry of [...entries].sort((left, right) => compareText(left.licence, right.licence))) {
    let row = rowsByLicence.get(entry.licence)
    if (row === undefined) {
      row = { licence: entry.licence, supplyingLicenceIds: [], notes: [] }
      rowsByLicence.set(entry.licence, row)
    }
    appendOnce(row.supplyingLicenceIds, entry.viaLicenceIds[0])
    appendOnce(row.notes, entry.note)
  }
  return [...rowsByLicence.values()]
}
