import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { customChangeBaseline, customChangeNotice, customChangeStatus, isTouched, overlayFieldPaths } from './customChangeNotice'
import type { HistoryIndex } from './historyIndex'
import type { FieldChange } from './ruleChanges'
import { vocabularyIndexOf } from './testVocabularyFixtures'

function change(path: string[]): FieldChange {
  return { kind: 'behaviour', path, display: 'value', before: 1, after: 2 }
}

const vocabularyIndex = vocabularyIndexOf({ versions: [{ label: 'macOS 27', terms: ['macOS 27.0'] }] })

describe('overlayFieldPaths', () => {
  it('lists the paths an overlay sets, going into plain objects and stopping at arrays and values', () => {
    const overlay = JSON.parse(
      readFileSync(new URL('../../../baselines/_overlays/rules/asd-blueprint-remove-powershell-v2.json', import.meta.url), 'utf8'),
    ) as { fields: Record<string, unknown> }

    expect(overlayFieldPaths(overlay.fields)).toEqual([
      ['applicability'],
      ['references', 'asd_blueprint'],
      ['remediation', 'Windows', 'steps'],
      ['remediation', 'Windows', 'payloads'],
    ])
  })

  it('treats an empty object as a path of its own', () => {
    expect(overlayFieldPaths({ references: {}, tags: ['a'], title: 'x' })).toEqual([['references'], ['tags'], ['title']])
  })
})

describe('isTouched', () => {
  it('is true when either path is a prefix of the other', () => {
    expect(isTouched(['remediation', 'Windows', 'steps'], [['remediation']])).toBe(true)
    expect(isTouched(['remediation'], [['remediation', 'Windows', 'steps']])).toBe(true)
    expect(isTouched(['tags'], [['tags']])).toBe(true)
  })

  it('is false when the paths diverge or no overlay path is given', () => {
    expect(isTouched(['remediation', 'macOS', 'steps'], [['remediation', 'Windows']])).toBe(false)
    expect(isTouched(['title'], [['discussion']])).toBe(false)
    expect(isTouched(['title'], [])).toBe(false)
  })
})

describe('customChangeBaseline', () => {
  const index = {
    schema_version: 1,
    source: 'mscp',
    releases: ['release_26.0', 'release_27.0', 'release_27.1'].map((tag) => ({ tag, label: tag.replace('release_', ''), published_date: '2026-01-01', index_path: `mscp/releases/${tag}/_index.json` })),
    rules: {},
  } as HistoryIndex

  it('is the release itself when the history has it', () => {
    expect(customChangeBaseline(index, 'release_27.0')).toEqual({ fromTag: 'release_27.0', inHistory: true })
  })

  it('is the earliest stored release, marked not in history, for any other release', () => {
    expect(customChangeBaseline(index, 'tahoe_rev3')).toEqual({ fromTag: 'release_26.0', inHistory: false })
  })
})

describe('customChangeStatus', () => {
  it('is unchanged when the rule did not change', () => {
    expect(customChangeStatus([], [['title']], vocabularyIndex)).toEqual({ kind: 'unchanged' })
  })

  it('is untouched when the rule changed only outside the fields the custom changes set', () => {
    expect(customChangeStatus([change(['discussion'])], [['title']], vocabularyIndex)).toEqual({ kind: 'untouched' })
  })

  it('is touched, with plain labels of the touched changes once each, when a changed field is one they set', () => {
    const status = customChangeStatus(
      [change(['discussion']), change(['remediation', 'Windows', 'steps', '0', 'shell']), change(['remediation', 'Windows', 'steps', '1', 'shell']), change(['applicability', 'macOS 27.0', 'benchmarks'])],
      [['remediation', 'Windows', 'steps'], ['applicability']],
      vocabularyIndex,
    )

    expect(status).toEqual({ kind: 'touched', labels: ['Fix · Windows · Step 1', 'Fix · Windows · Step 2', 'Benchmarks · macOS 27'] })
  })
})

describe('customChangeNotice', () => {
  const written = { releaseLabel: 'Mar 2026', earliestLabel: 'Dec 2025' }

  it('warns with a bold opening and the touched fields when the rule changed in them', () => {
    expect(customChangeNotice({ kind: 'touched', labels: ['Check · macOS', 'Title'] }, { ...written, inHistory: true })).toEqual({
      tone: 'warning',
      lead: 'Your custom changes to this rule were written for Mar 2026.',
      text: 'The rule has since been updated in a field your custom changes touch (Check · macOS, Title).',
      linksToChanges: true,
    })
  })

  it('is muted when the rule changed elsewhere', () => {
    expect(customChangeNotice({ kind: 'untouched' }, { ...written, inHistory: true })).toEqual({
      tone: 'muted',
      lead: null,
      text: 'Your custom changes to this rule were written for Mar 2026. The rule has since been updated, but not in any field your custom changes touch.',
      linksToChanges: true,
    })
  })

  it('says the rule has not changed, with no link, so the custom changes can be marked as up to date', () => {
    expect(customChangeNotice({ kind: 'unchanged' }, { ...written, inHistory: true })).toEqual({
      tone: 'muted',
      lead: null,
      text: "Your custom changes to this rule were written for Mar 2026. The rule hasn't changed since, so they can be marked as up to date.",
      linksToChanges: false,
    })
  })

  it('opens differently for a release the history does not keep, and says what it compared from', () => {
    const notice = customChangeNotice({ kind: 'touched', labels: ['Title'] }, { releaseLabel: 'tahoe_rev3', earliestLabel: 'Dec 2025', inHistory: false })

    expect(notice.lead).toBe("Your custom changes to this rule were written for tahoe_rev3, which isn't one of the releases kept here.")
    expect(notice.text).toBe(
      'The rule has since been updated in a field your custom changes touch (Title). Compared from Dec 2025, the earliest release kept.',
    )
    expect(customChangeNotice({ kind: 'untouched' }, { releaseLabel: 'tahoe_rev3', earliestLabel: 'Dec 2025', inHistory: false }).text).toBe(
      "Your custom changes to this rule were written for tahoe_rev3, which isn't one of the releases kept here. The rule has since been updated, but not in any field your custom changes touch. Compared from Dec 2025, the earliest release kept.",
    )
  })
})
