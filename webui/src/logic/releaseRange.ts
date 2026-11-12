import { DEFAULT_AUTOMATION, DEFAULT_PAGE_SIZE, parseUrlState, serializeUrlLocation } from '../state/urlState'

export const EMPTY_RELEASE_TAG = 'empty'
export const EMPTY_RELEASE_LABEL = 'Empty release'

export interface ComparisonRange {
  fromTag: string
  toTag: string
}

// A real release tagged "empty" wins, so that source has no empty baseline.
export function isEmptyRelease(releaseTags: readonly string[], tag: string): boolean {
  return tag === EMPTY_RELEASE_TAG && !releaseTags.includes(EMPTY_RELEASE_TAG)
}

export function previousReleaseTag(releaseTags: readonly string[], tag: string): string | null {
  const position = releaseTags.indexOf(tag)
  if (position === -1) return null
  return position === 0 ? EMPTY_RELEASE_TAG : releaseTags[position - 1]
}

export function resolveComparisonRange(releaseTags: readonly string[], from: string | null, to: string | null): ComparisonRange {
  if (releaseTags.length === 0) throw new Error('A comparison range needs at least one release')
  const toPosition = to === null ? -1 : releaseTags.indexOf(to)
  if (from !== null && to !== null && toPosition !== -1) {
    const fromIsEarlierRelease = releaseTags.indexOf(from) !== -1 && releaseTags.indexOf(from) < toPosition
    if (fromIsEarlierRelease || isEmptyRelease(releaseTags, from)) return { fromTag: from, toTag: to }
  }
  if (releaseTags.length === 1) return { fromTag: EMPTY_RELEASE_TAG, toTag: releaseTags[0] }
  return { fromTag: releaseTags[releaseTags.length - 2], toTag: releaseTags[releaseTags.length - 1] }
}

export function releaseLabel(releases: readonly { tag: string; label: string }[], tag: string): string {
  const releaseTags = releases.map((release) => release.tag)
  if (isEmptyRelease(releaseTags, tag)) return EMPTY_RELEASE_LABEL
  return releases.find((release) => release.tag === tag)?.label ?? tag
}

export function comparisonLocation(sourceName: string, range: ComparisonRange, basePath: string): string {
  const state = { ...parseUrlState(''), view: 'frameworks', framework: sourceName, compareFrom: range.fromTag, compareTo: range.toTag }
  return serializeUrlLocation(state, { automation: DEFAULT_AUTOMATION, size: DEFAULT_PAGE_SIZE }, basePath)
}
