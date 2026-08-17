// baselines/*/_index.json sorts rules by (id, file) as plain strings, which
// misorders real ids like "2.12.2" before "2.1.1.1" and "106.1.1" as if it
// were under section "1". Anywhere the UI groups or orders rules by id, it
// must use this comparator instead of trusting index order.

function compareSegment(segmentA: string, segmentB: string): number {
  const numberA = Number(segmentA)
  const numberB = Number(segmentB)
  const isNumericA = segmentA !== '' && Number.isFinite(numberA)
  const isNumericB = segmentB !== '' && Number.isFinite(numberB)

  if (isNumericA && isNumericB) {
    return numberA - numberB
  }
  return segmentA < segmentB ? -1 : segmentA > segmentB ? 1 : 0
}

export function naturalIdCompare(idA: string, idB: string): number {
  const segmentsA = idA.split('.')
  const segmentsB = idB.split('.')
  const sharedLength = Math.min(segmentsA.length, segmentsB.length)

  for (let index = 0; index < sharedLength; index += 1) {
    const result = compareSegment(segmentsA[index], segmentsB[index])
    if (result !== 0) return result
  }
  return segmentsA.length - segmentsB.length
}

export function topLevelSection(id: string): string {
  return id.split('.')[0]
}
