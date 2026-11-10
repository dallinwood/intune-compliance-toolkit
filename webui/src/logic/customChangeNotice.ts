// The notice on a rule whose custom changes were written for an older release:
// did the rule change since in a field the custom changes touch?
import { changeLabel } from './changeLabels'
import type { HistoryIndex } from './historyIndex'
import type { FieldChange } from './ruleChanges'
import type { VocabularyIndex } from './vocabulary'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// The paths an overlay's fields set: into plain objects, stopping at arrays and values.
export function overlayFieldPaths(fields: Record<string, unknown>): string[][] {
  const paths: string[][] = []
  function visit(prefix: string[], value: Record<string, unknown>) {
    for (const [key, member] of Object.entries(value)) {
      const path = [...prefix, key]
      if (isPlainObject(member) && Object.keys(member).length > 0) visit(path, member)
      else paths.push(path)
    }
  }
  visit([], fields)
  return paths
}

// A change touches the custom changes when its path and one of theirs are one
// the prefix of the other.
export function isTouched(changePath: string[], overlayPaths: string[][]): boolean {
  return overlayPaths.some((overlayPath) => {
    const sharedLength = Math.min(changePath.length, overlayPath.length)
    return changePath.slice(0, sharedLength).every((segment, position) => segment === overlayPath[position])
  })
}

// Releases from different eras cannot be ordered reliably (tahoe_rev3 against
// release_27.0), so a release the history does not keep, whether older than it
// or missing for another reason, is compared from the earliest release kept.
export function customChangeBaseline(index: HistoryIndex, overlayRelease: string): { fromTag: string; inHistory: boolean } {
  if (index.releases.some((release) => release.tag === overlayRelease)) return { fromTag: overlayRelease, inHistory: true }
  return { fromTag: index.releases[0].tag, inHistory: false }
}

export type CustomChangeStatus = { kind: 'touched'; labels: string[] } | { kind: 'untouched' } | { kind: 'unchanged' }

export function customChangeStatus(changes: FieldChange[], overlayPaths: string[][], vocabularyIndex: VocabularyIndex): CustomChangeStatus {
  if (changes.length === 0) return { kind: 'unchanged' }
  const touched = changes.filter((change) => isTouched(change.path, overlayPaths))
  if (touched.length === 0) return { kind: 'untouched' }
  return { kind: 'touched', labels: [...new Set(touched.map((change) => changeLabel(change.path, vocabularyIndex)))] }
}

export interface CustomChangeNotice {
  tone: 'warning' | 'muted'
  // The bold opening of the warning; null when the whole notice is one muted sentence.
  lead: string | null
  text: string
  linksToChanges: boolean
}

export function customChangeNotice(
  status: CustomChangeStatus,
  written: { releaseLabel: string; earliestLabel: string; inHistory: boolean },
): CustomChangeNotice {
  const opening = written.inHistory
    ? `Your custom changes to this rule were written for ${written.releaseLabel}.`
    : `Your custom changes to this rule were written for ${written.releaseLabel}, which isn't one of the releases kept here.`
  const comparedFrom = written.inHistory ? '' : ` Compared from ${written.earliestLabel}, the earliest release kept.`
  if (status.kind === 'touched') {
    return {
      tone: 'warning',
      lead: opening,
      text: `The rule has since been updated in a field your custom changes touch (${status.labels.join(', ')}).${comparedFrom}`,
      linksToChanges: true,
    }
  }
  if (status.kind === 'untouched') {
    return {
      tone: 'muted',
      lead: null,
      text: `${opening} The rule has since been updated, but not in any field your custom changes touch.${comparedFrom}`,
      linksToChanges: true,
    }
  }
  return {
    tone: 'muted',
    lead: null,
    text: `${opening} The rule hasn't changed since, so they can be marked as up to date.${comparedFrom}`,
    linksToChanges: false,
  }
}
