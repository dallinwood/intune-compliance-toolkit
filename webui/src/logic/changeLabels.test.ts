import { describe, expect, it } from 'vitest'
import type { TimelineEntry } from './historyIndex'
import { KIND_LABELS, changeLabel, historyTabLabel, quietRunSummary, timelineStateText, visibleChanges } from './changeLabels'
import { CHANGE_KINDS, type ChangeKind, type FieldChange } from './ruleChanges'
import { vocabularyIndexOf } from './testVocabularyFixtures'

const vocabularyIndex = vocabularyIndexOf({
  versions: [
    { label: 'macOS 27', terms: ['macOS 27.0'] },
    { label: 'macOS 26', terms: ['macOS 26.0'] },
  ],
})

describe('KIND_LABELS', () => {
  it('has a plain-word label for every kind of change', () => {
    expect(CHANGE_KINDS.map((kind) => KIND_LABELS[kind])).toEqual(['Behaviour', 'Scope', 'Wording', 'References'])
  })
})

describe('changeLabel', () => {
  it.each([
    [['check', 'macOS', 'default', 'shell'], 'Check · macOS'],
    [['check', 'macOS', 'default', 'result', 'value'], 'Check · macOS · Result value'],
    [['check', 'macOS', 'default', 'additional_info'], 'Check · macOS · Additional info'],
    [['check', 'macOS', 'by_version', '26.0', 'result', 'type'], 'Check · macOS 26 · Result type'],
    [['remediation', 'macOS', 'steps', '0', 'language'], 'Fix · macOS · Step 1 · Language'],
    [['check', 'macOS', 'by_version', '26.0', 'shell'], 'Check · macOS 26'],
    [['remediation', 'macOS', 'steps', '1', 'shell'], 'Fix · macOS · Step 2'],
    [['remediation', 'Windows', 'payloads', '0', 'data'], 'Fix · Windows · Payload 1'],
    [['applicability', 'macOS 27.0', 'benchmarks'], 'Benchmarks · macOS 27'],
    [['applicability', 'macOS 99.0'], 'Benchmarks · macOS 99.0'],
    [['applicability', 'none', 'benchmarks'], 'Benchmarks · None'],
    [['title'], 'Title'],
    [['discussion'], 'Discussion'],
    [['discussion_format'], 'Discussion format'],
    [['odv', 'recommended'], 'Organization-defined value · Recommended'],
    [['odv', 'by_benchmark', 'cis_lvl1'], 'Organization-defined value · By benchmark'],
    [['assessment', 'status'], 'Assessment · Status'],
    [['assessment', 'manual_reason'], 'Assessment · Manual reason'],
    [['architecture'], 'Architecture'],
    [['references', 'cis'], 'References'],
    [['tags'], 'Tags'],
    [['section_path'], 'Section'],
    [['some_new_field'], 'some_new_field'],
  ])('turns %j into %j', (path, label) => {
    expect(changeLabel(path as string[], vocabularyIndex)).toBe(label)
  })
})

describe('visibleChanges', () => {
  const change = (kind: ChangeKind, path: string[]): FieldChange => ({ kind, path, display: 'value', before: 1, after: 2 })
  const title = change('wording', ['title'])
  const shell = change('behaviour', ['check', 'macOS', 'default', 'shell'])
  const tags = change('references', ['tags'])
  const step = change('behaviour', ['remediation', 'Windows', 'steps', '0', 'shell'])

  it('keeps every change when no kinds are given', () => {
    expect(visibleChanges([title, shell, tags], undefined, undefined)).toEqual([title, shell, tags])
  })

  it('keeps only the given kinds', () => {
    expect(visibleChanges([title, shell, tags], new Set<ChangeKind>(['behaviour', 'references']), undefined)).toEqual([shell, tags])
  })

  it('puts changes under a focus path first, keeping the order otherwise', () => {
    expect(visibleChanges([title, shell, tags, step], undefined, [['remediation'], ['tags']])).toEqual([tags, step, title, shell])
  })

  it('treats a focus path and a change path as touching when either is a prefix of the other', () => {
    expect(visibleChanges([title, shell], undefined, [['check', 'macOS', 'default', 'shell', 'extra']])).toEqual([shell, title])
    expect(visibleChanges([title, shell], undefined, [['check']])).toEqual([shell, title])
  })
})

describe('history wording', () => {
  const entry = (state: TimelineEntry['state'], label = 'Sep 2026'): TimelineEntry => ({ tag: 't', label, state, kinds: [] })

  it('labels the tab with the number of changes, singular for one', () => {
    expect(historyTabLabel(0)).toBe('History (0 changes)')
    expect(historyTabLabel(1)).toBe('History (1 change)')
    expect(historyTabLabel(7)).toBe('History (7 changes)')
  })

  it('words the state of a release where the rule appeared, disappeared or started', () => {
    expect(timelineStateText(entry('earliest'))).toBe('earliest release in history')
    expect(timelineStateText(entry('added', 'Mar 2026'))).toBe('Added in Mar 2026')
    expect(timelineStateText(entry('removed', 'Jun 2026'))).toBe('Removed in Jun 2026')
    expect(timelineStateText(entry('changed'))).toBeNull()
  })

  it('summarises a run of releases with no changes, or without the rule', () => {
    expect(quietRunSummary([entry('unchanged', 'Sep 2026')])).toBe('1 release with no changes (Sep 2026)')
    expect(quietRunSummary([entry('unchanged', 'Sep 2026'), entry('unchanged', 'Jun 2026')])).toBe('2 releases with no changes (Sep 2026, Jun 2026)')
    expect(quietRunSummary([entry('absent', 'Mar 2026'), entry('absent', 'Dec 2025')])).toBe('2 releases without this rule (Mar 2026, Dec 2025)')
  })
})
