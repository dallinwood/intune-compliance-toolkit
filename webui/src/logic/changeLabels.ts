import type { Rule } from '../types/library'
import { NONE_LABEL, NO_VERSION_KEY, versionKey } from './applicability'
import type { TimelineEntry } from './historyIndex'
import type { ChangeKind, FieldChange } from './ruleChanges'
import { termLabel, type VocabularyIndex } from './vocabulary'

export const KIND_LABELS: Record<ChangeKind, string> = {
  behaviour: 'Behaviour',
  scope: 'Scope',
  wording: 'Wording',
  references: 'References',
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  title: 'Title',
  discussion: 'Discussion',
  discussion_format: 'Discussion format',
  check: 'Check',
  remediation: 'Fix',
  odvs: 'Organization-defined values',
  assessment: 'Assessment',
  architecture: 'Architecture',
  applicability: 'Benchmarks',
  references: 'References',
  tags: 'Tags',
  section_path: 'Section',
}

function scopeLabel(scopeKey: string, vocabularyIndex: VocabularyIndex): string {
  return scopeKey === NO_VERSION_KEY ? NONE_LABEL : termLabel(vocabularyIndex, 'versions', scopeKey)
}

function sentenceCase(code: string): string {
  const words = code.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// How many check items each target has: the most of any rule given, so a diff
// between two versions of a rule labels items by the larger list.
export type CheckItemCounts = Readonly<Record<string, number>>

export function checkItemCounts(...rules: Pick<Rule, 'check'>[]): CheckItemCounts {
  const counts: Record<string, number> = {}
  for (const rule of rules) {
    for (const [target, items] of Object.entries(rule.check ?? {})) counts[target] = Math.max(counts[target] ?? 0, items.length)
  }
  return counts
}

// "Check" for a target with one item; "Check 2" when the target has several
// (or, when the counts are not known, for any item after the first).
function checkHeading(target: string, itemPosition: number, counts: CheckItemCounts | undefined): string {
  const hasSeveralItems = counts === undefined ? itemPosition > 0 : (counts[target] ?? 0) > 1 || itemPosition > 0
  return hasSeveralItems ? `Check ${itemPosition + 1}` : 'Check'
}

// What a changed part of a check or fix is called: the target (or the
// version it is for, or the step or payload), then the part itself unless it
// is the script, which is what a reader of a check or fix expects. A check's
// path has the item's position between the target and what changed.
function scriptFieldParts(field: string, rest: string[], vocabularyIndex: VocabularyIndex): string[] {
  const [target, ...afterTarget] = rest
  const inTarget = field === 'check' ? afterTarget.slice(1) : afterTarget
  const parts: string[] = []
  let remaining = inTarget
  if (field === 'check' && inTarget[0] === 'by_version' && inTarget.length > 1) {
    parts.push(termLabel(vocabularyIndex, 'versions', versionKey(target, inTarget[1])))
    remaining = inTarget.slice(2)
  } else {
    parts.push(target)
    if (field === 'check' && inTarget[0] === 'default') {
      remaining = inTarget.slice(1)
    } else if (field === 'remediation' && inTarget[0] === 'steps' && inTarget.length > 1) {
      parts.push(`Step ${Number(inTarget[1]) + 1}`)
      remaining = inTarget.slice(2)
    } else if (field === 'remediation' && inTarget[0] === 'payloads' && inTarget.length > 1) {
      parts.push(`Payload ${Number(inTarget[1]) + 1}`)
      remaining = inTarget.slice(2)
    }
  }
  if (remaining[0] === 'registry' && remaining.length > 1 && /^[0-9]+$/.test(remaining[1])) {
    const settingLabel = `Registry setting ${Number(remaining[1]) + 1}`
    const insideSetting = remaining.slice(2)
    parts.push(insideSetting.length > 0 ? `${settingLabel} ${insideSetting.join(' ').replaceAll('_', ' ')}` : settingLabel)
    return parts
  }
  const isTheScript = remaining.length === 1 && (remaining[0] === 'shell' || remaining[0] === 'script' || remaining[0] === 'data')
  if (remaining.length > 0 && !isTheScript) parts.push(sentenceCase(remaining.join(' ')))
  return parts
}

// A changed field's path in plain words for a reader of the diff, parts
// joined with " · ": the field, then where in it (a target, a version, a step).
export function changeLabel(path: string[], vocabularyIndex: VocabularyIndex, counts?: CheckItemCounts): string {
  const [field, ...rest] = path
  const parts = [FIELD_LABELS[field] ?? field]
  if (field === 'check' && rest.length >= 2) parts[0] = checkHeading(rest[0], Number(rest[1]), counts)
  if (field === 'assessment' && rest.length > 0) {
    parts.push(sentenceCase(rest[0]))
  } else if (field === 'odvs' && rest.length > 0) {
    const [position, ...inOdv] = rest
    parts.push(`Value ${Number(position) + 1}`)
    if (inOdv.length > 0) parts.push(sentenceCase(inOdv[0]))
  } else if (field === 'applicability' && rest.length > 0) {
    parts.push(scopeLabel(rest[0], vocabularyIndex))
  } else if ((field === 'check' || field === 'remediation') && rest.length > 0) {
    parts.push(...scriptFieldParts(field, rest, vocabularyIndex))
  }
  return parts.join(' · ')
}

function pathsTouch(left: string[], right: string[]): boolean {
  const sharedLength = Math.min(left.length, right.length)
  return left.slice(0, sharedLength).every((segment, position) => segment === right[position])
}

// The changes to draw: only the wanted kinds, and the ones under a focus path
// (what a reader's custom changes touch) before the rest.
export function visibleChanges(
  changes: FieldChange[],
  kinds: ReadonlySet<ChangeKind> | undefined,
  focusPaths: string[][] | undefined,
): FieldChange[] {
  const wanted = kinds === undefined ? changes : changes.filter((change) => kinds.has(change.kind))
  if (focusPaths === undefined || focusPaths.length === 0) return wanted
  const isFocused = (change: FieldChange) => focusPaths.some((focusPath) => pathsTouch(focusPath, change.path))
  return [...wanted.filter(isFocused), ...wanted.filter((change) => !isFocused(change))]
}

// Plain "History" until the count is known, so the tab does not change width when it arrives.
export function historyTabLabel(changeCount: number | null): string {
  if (changeCount === null) return 'History'
  return `History (${changeCount} ${changeCount === 1 ? 'change' : 'changes'})`
}

// What a release's card says about the rule's presence; null when the card is
// about a change in the rule's content instead.
export function timelineStateText(entry: TimelineEntry): string | null {
  if (entry.state === 'added') return `Added in ${entry.label}`
  if (entry.state === 'removed') return `Removed in ${entry.label}`
  return null
}

// The end marker for the oldest release kept: not a change, so not a card.
export function startingPointText(entry: TimelineEntry): string {
  return `${entry.label} (${entry.tag}) · starting point: the oldest release kept here`
}

function isHiddenChange(entry: TimelineEntry, shownKinds: ReadonlySet<ChangeKind>): boolean {
  return entry.state === 'changed' && !entry.kinds.some((kind) => shownKinds.has(kind))
}

export function quietRunSummary(entries: TimelineEntry[], shownKinds: ReadonlySet<ChangeKind>): string {
  const noun = entries.length === 1 ? 'release' : 'releases'
  const what =
    entries[0].state === 'absent' ? 'without this rule' : entries.some((entry) => isHiddenChange(entry, shownKinds)) ? 'with no changes shown' : 'with no changes'
  return `${entries.length} ${noun} ${what} (${entries.map((entry) => entry.label).join(', ')})`
}

// What a release folded into a quiet bar holds.
export function quietEntryText(entry: TimelineEntry, shownKinds: ReadonlySet<ChangeKind>): string {
  if (entry.state === 'absent') return 'Not in this release'
  if (isHiddenChange(entry, shownKinds)) return `Changes hidden: ${entry.kinds.map((kind) => KIND_LABELS[kind]).join(', ')}`
  return 'No changes'
}
