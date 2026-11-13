import { describe, expect, it } from 'vitest'
import type { HistoryIndex } from './historyIndex'
import type { KindFingerprints } from './ruleChanges'
import {
  buildGenerateChecks,
  hasBlockingCheck,
  newestReleaseChange,
  severityCounts,
  type GenerateCheckInput,
} from './generateChecks'

const EMPTY_INPUT: GenerateCheckInput = {
  blocked: [],
  skippedCustomChanges: [],
  customChanges: [],
  newestReleaseChanges: [],
  historyUnavailableSourceLabels: [],
}

function inputWith(overrides: Partial<GenerateCheckInput>): GenerateCheckInput {
  return { ...EMPTY_INPUT, ...overrides }
}

function fingerprints(overrides: Partial<KindFingerprints> = {}): KindFingerprints {
  return { behaviour: 'b1', scope: 's1', wording: 'w1', references: 'r1', ...overrides }
}

function historyWith(versions: (KindFingerprints | null)[]): HistoryIndex {
  return {
    schema_version: 1,
    source: 'mscp',
    releases: versions.map((_, position) => ({
      tag: `tag-${position}`,
      label: `Release ${position}`,
      published_date: '2026-01-01',
      index_path: `releases/tag-${position}/index.json`,
    })),
    rules: { 'mscp.rule.a': { title: 'Rule A', file: 'a.json', section: 'os', benchmarks: [], versions } },
  }
}

describe('buildGenerateChecks', () => {
  it('blocked entries become one organization-value error with the reason as detail', () => {
    const checks = buildGenerateChecks(
      inputWith({
        blocked: [
          { id: 'mscp.b', title: 'B', reason: 'Needs an organization value', supportingCheck: false },
          { id: 'mscp.a', title: 'A', reason: 'Organization value is invalid: x', supportingCheck: false },
        ],
      }),
    )
    expect(checks).toHaveLength(1)
    expect(checks[0].id).toBe('organization-value')
    expect(checks[0].severity).toBe('error')
    expect(checks[0].message).toBe(
      "Fix these before generating: set a valid organization value in each rule's details on the browse screen.",
    )
    expect(checks[0].occurrences).toEqual([
      { ruleId: 'mscp.a', title: 'A', detail: 'Organization value is invalid: x', supportingCheck: false },
      { ruleId: 'mscp.b', title: 'B', detail: 'Needs an organization value', supportingCheck: false },
    ])
  })

  it('marks a supporting check occurrence and adds where to fix it to the message', () => {
    const checks = buildGenerateChecks(
      inputWith({
        blocked: [
          { id: 'mscp.a', title: 'A', reason: 'Needs an organization value', supportingCheck: false },
          { id: 'mscp.b', title: 'B', reason: 'Needs an organization value', supportingCheck: true },
        ],
      }),
    )
    expect(checks[0].message).toBe(
      "Fix these before generating: set a valid organization value in each rule's details on the browse screen. " +
        'For supporting checks, set the value under Supporting checks below.',
    )
    expect(checks[0].occurrences).toEqual([
      { ruleId: 'mscp.a', title: 'A', detail: 'Needs an organization value', supportingCheck: false },
      { ruleId: 'mscp.b', title: 'B', detail: 'Needs an organization value (supporting check)', supportingCheck: true },
    ])
  })

  it('skipped custom changes become a warning naming the custom change and message', () => {
    const checks = buildGenerateChecks(
      inputWith({
        skippedCustomChanges: [
          {
            ruleId: 'mscp.a',
            title: 'A',
            skipped: [
              { overlayId: 'custom-1', message: 'path missing' },
              { overlayId: 'custom-2', message: 'bad value' },
            ],
          },
        ],
      }),
    )
    expect(checks[0].id).toBe('custom-changes-not-applied')
    expect(checks[0].severity).toBe('warning')
    expect(checks[0].message).toBe(
      'Custom changes could not be applied to these rules; they are shown and generated as imported.',
    )
    expect(checks[0].occurrences.map((occurrence) => occurrence.detail)).toEqual([
      'custom-1: path missing',
      'custom-2: bad value',
    ])
  })

  it('a touched comparison is custom-changes-outdated with the changed labels', () => {
    const checks = buildGenerateChecks(
      inputWith({
        customChanges: [
          {
            ruleId: 'mscp.a',
            title: 'A',
            result: { kind: 'compared', status: { kind: 'touched', labels: ['Check', 'Fix'] }, releaseLabel: 'Sonoma 1' },
          },
        ],
      }),
    )
    expect(checks[0].id).toBe('custom-changes-outdated')
    expect(checks[0].severity).toBe('warning')
    expect(checks[0].message).toBe(
      'Custom changes were written for an older release, and the rule has since changed in a field they touch. Review them before deploying.',
    )
    expect(checks[0].occurrences[0].detail).toBe('Written for Sonoma 1; changed: Check, Fix')
  })

  it('an unknown comparison is custom-changes-outdated saying it could not compare', () => {
    const checks = buildGenerateChecks(
      inputWith({
        customChanges: [{ ruleId: 'mscp.a', title: 'A', result: { kind: 'unknown', release: 'v0.9' } }],
      }),
    )
    expect(checks[0].id).toBe('custom-changes-outdated')
    expect(checks[0].occurrences[0].detail).toBe('Written for v0.9; could not compare with the release history.')
  })

  it('untouched and unchanged comparisons are custom-changes-older-release notes', () => {
    const checks = buildGenerateChecks(
      inputWith({
        customChanges: [
          { ruleId: 'mscp.a', title: 'A', result: { kind: 'compared', status: { kind: 'untouched' }, releaseLabel: 'R1' } },
          { ruleId: 'mscp.b', title: 'B', result: { kind: 'compared', status: { kind: 'unchanged' }, releaseLabel: 'R2' } },
        ],
      }),
    )
    expect(checks).toHaveLength(1)
    expect(checks[0].id).toBe('custom-changes-older-release')
    expect(checks[0].severity).toBe('info')
    expect(checks[0].message).toBe(
      'Custom changes were written for an older release; the rule has not changed in any field they touch.',
    )
    expect(checks[0].occurrences.map((occurrence) => occurrence.detail)).toEqual(['Written for R1', 'Written for R2'])
  })

  it('formats changed-in-newest-release occurrences', () => {
    const checks = buildGenerateChecks(
      inputWith({
        newestReleaseChanges: [
          { ruleId: 'mscp.a', title: 'A', change: { kind: 'changed', kinds: ['behaviour', 'scope'], previousLabel: 'R1' } },
          { ruleId: 'mscp.b', title: 'B', change: { kind: 'added', currentLabel: 'R2' } },
        ],
      }),
    )
    expect(checks[0].id).toBe('changed-in-newest-release')
    expect(checks[0].message).toBe(
      'Changed in the newest release of its framework. What it checks or where it applies may differ from earlier bundles.',
    )
    expect(checks[0].occurrences.map((occurrence) => occurrence.detail)).toEqual([
      'Behaviour, Scope since R1',
      'New in R2',
    ])
  })

  it('history-unavailable appears with source labels and no occurrences', () => {
    const checks = buildGenerateChecks(inputWith({ historyUnavailableSourceLabels: ['mSCP', 'ASD ISM'] }))
    expect(checks).toEqual([
      {
        id: 'history-unavailable',
        severity: 'info',
        message: 'Release history could not be loaded for mSCP, ASD ISM, so release checks were skipped for their rules.',
        occurrences: [],
      },
    ])
  })

  it('checks with no occurrences are omitted; an empty input gives []', () => {
    expect(buildGenerateChecks(EMPTY_INPUT)).toEqual([])
  })

  it('orders errors, then warnings, then notes, then catalogue order; occurrences by upstream id', () => {
    const checks = buildGenerateChecks({
      blocked: [{ id: 'mscp.x', title: 'X', reason: 'r', supportingCheck: false }],
      skippedCustomChanges: [{ ruleId: 'mscp.x', title: 'X', skipped: [{ overlayId: 'o', message: 'm' }] }],
      customChanges: [
        { ruleId: 'asd_ism.b.1', title: 'B', result: { kind: 'unknown', release: 'v1' } },
        { ruleId: 'mscp.a', title: 'A', result: { kind: 'unknown', release: 'v1' } },
        { ruleId: 'mscp.c', title: 'C', result: { kind: 'compared', status: { kind: 'unchanged' }, releaseLabel: 'R' } },
      ],
      newestReleaseChanges: [{ ruleId: 'mscp.x', title: 'X', change: { kind: 'added', currentLabel: 'R' } }],
      historyUnavailableSourceLabels: ['S'],
    })
    expect(checks.map((check) => check.id)).toEqual([
      'organization-value',
      'custom-changes-not-applied',
      'custom-changes-outdated',
      'custom-changes-older-release',
      'changed-in-newest-release',
      'history-unavailable',
    ])
    const outdated = checks.find((check) => check.id === 'custom-changes-outdated')
    expect(outdated?.occurrences.map((occurrence) => occurrence.ruleId)).toEqual(['mscp.a', 'asd_ism.b.1'])
  })
})

describe('newestReleaseChange', () => {
  it('reports behaviour and scope changes with the previous label', () => {
    const history = historyWith([fingerprints(), fingerprints({ behaviour: 'b2', scope: 's2' })])
    expect(newestReleaseChange(history, 'mscp.rule.a')).toEqual({
      kind: 'changed',
      kinds: ['behaviour', 'scope'],
      previousLabel: 'Release 0',
    })
  })

  it('ignores wording-only and references-only changes', () => {
    const history = historyWith([fingerprints(), fingerprints({ wording: 'w2', references: 'r2' })])
    expect(newestReleaseChange(history, 'mscp.rule.a')).toBeNull()
  })

  it('reports a rule new in the current release', () => {
    const history = historyWith([null, fingerprints()])
    expect(newestReleaseChange(history, 'mscp.rule.a')).toEqual({ kind: 'added', currentLabel: 'Release 1' })
  })

  it('is null for a single-release source, an absent rule, or a rule gone from the current release', () => {
    expect(newestReleaseChange(historyWith([fingerprints()]), 'mscp.rule.a')).toBeNull()
    expect(newestReleaseChange(historyWith([fingerprints(), fingerprints({ scope: 's2' })]), 'mscp.missing')).toBeNull()
    expect(newestReleaseChange(historyWith([fingerprints(), null]), 'mscp.rule.a')).toBeNull()
  })
})

describe('hasBlockingCheck and severityCounts', () => {
  const errorCheck = buildGenerateChecks(inputWith({ blocked: [{ id: 'mscp.a', title: 'A', reason: 'r', supportingCheck: false }] }))
  const noteCheck = buildGenerateChecks(inputWith({ historyUnavailableSourceLabels: ['S'] }))

  it('hasBlockingCheck is true only with an error check', () => {
    expect(hasBlockingCheck(errorCheck)).toBe(true)
    expect(hasBlockingCheck(noteCheck)).toBe(false)
    expect(hasBlockingCheck([])).toBe(false)
  })

  it('severityCounts counts checks per severity', () => {
    expect(severityCounts([...errorCheck, ...noteCheck])).toEqual({ error: 1, warning: 0, info: 1 })
  })
})
