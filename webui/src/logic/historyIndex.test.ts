import { describe, expect, it } from 'vitest'
import type { ManifestSource, Rule } from '../types/library'
import type { ChangeKind } from './ruleChanges'
import {
  HISTORY_INDEX_SCHEMA_VERSION,
  buildHistoryIndex,
  changeCount,
  compareReleases,
  foldQuietRuns,
  latestReleaseWithRule,
  parseHistoryIndex,
  previousTagWithRule,
  ruleFilePathAtRelease,
  ruleTimeline,
  type HistoryIndex,
  type RuleWithFile,
  type TimelineEntry,
} from './historyIndex'
import { EMPTY_RELEASE_TAG } from './releaseRange'
import { applicabilityOfVersions, inlineRule, macosCheck, ruleCheck } from './testRuleFixtures'

const SOURCE: ManifestSource = {
  name: 'mscp',
  display_name: 'Example source',
  release_tag: 'R3',
  commit_sha: 'c'.repeat(40),
  retrieved_date: '2026-02-01',
  repository_url: 'https://example.test/repository',
  license: { name: 'CC BY 4.0', url: 'https://example.test/licence', rights_holder: 'Someone', modified: true },
  index_path: 'mscp/releases/R3/_index.json',
  rule_count: 3,
  releases: ['R1', 'R2', 'R3'].map((tag, position) => ({
    tag,
    label: `Release ${tag}`,
    published_date: `2025-0${position * 3 + 1}-01`,
    commit_sha: 'c'.repeat(40),
    retrieved_date: '2026-02-01',
    importer_format: 'example-1',
    index_path: `mscp/releases/${tag}/_index.json`,
    rule_count: 0,
  })),
}

function rule(upstreamId: string, tag: string, overrides: Partial<Rule> = {}): RuleWithFile {
  return { ...inlineRule({ upstreamId, releaseTag: tag, overrides }), file: `rules/${upstreamId}.json` }
}

function withCheck(shell: string): Partial<Rule> {
  return { check: macosCheck(ruleCheck(shell, { type: 'string', value: 'PASS' })) }
}

function buildFixture(): HistoryIndex {
  const rulesByTag = new Map<string, RuleWithFile[]>([
    [
      'R1',
      [
        rule('steady', 'R1'),
        rule('reverted', 'R1', withCheck('echo A')),
        rule('retitled', 'R1', { title: 'Old title' }),
        rule('dropped', 'R1', { title: 'Dropped rule' }),
        rule('gappy', 'R1'),
      ],
    ],
    ['R2', [rule('steady', 'R2'), rule('reverted', 'R2', withCheck('echo B')), rule('retitled', 'R2', { title: 'Old title' }), rule('fresh', 'R2')]],
    [
      'R3',
      [
        rule('steady', 'R3'),
        rule('reverted', 'R3', withCheck('echo A')),
        rule('retitled', 'R3', { title: 'New title' }),
        rule('fresh', 'R3'),
        rule('gappy', 'R3', { tags: ['back'] }),
      ],
    ],
  ])
  return buildHistoryIndex(SOURCE, rulesByTag)
}

describe('buildHistoryIndex', () => {
  it('lists the releases oldest first and aligns every rule with them', () => {
    const index = buildFixture()

    expect(index.schema_version).toBe(HISTORY_INDEX_SCHEMA_VERSION)
    expect(index.source).toBe('mscp')
    expect(index.releases.map((release) => release.tag)).toEqual(['R1', 'R2', 'R3'])
    expect(index.releases[0]).toEqual({ tag: 'R1', label: 'Release R1', published_date: '2025-01-01', index_path: 'mscp/releases/R1/_index.json' })
    expect(index.rules['mscp.fresh'].versions.map((version) => version !== null)).toEqual([false, true, true])
    expect(index.rules['mscp.dropped'].versions.map((version) => version !== null)).toEqual([true, false, false])
  })

  it('takes title, file, section and benchmarks from the latest release that has the rule', () => {
    const index = buildFixture()

    expect(index.rules['mscp.retitled'].title).toBe('New title')
    expect(index.rules['mscp.dropped']).toMatchObject({ title: 'Dropped rule', file: 'rules/dropped.json', section: 'os' })
  })

  it('lists each benchmark name once, sorted', () => {
    const withBenchmarks = rule('benchmarked', 'R3', {
      applicability: applicabilityOfVersions({
        'macOS 26.0': [{ name: 'cis_lvl2', severity: null }],
        'macOS 27.0': [
          { name: 'cis_lvl2', severity: null },
          { name: 'cis_lvl1', severity: null },
        ],
      }),
    })
    const index = buildHistoryIndex(SOURCE, new Map([['R3', [withBenchmarks]]]))

    expect(index.rules['mscp.benchmarked'].benchmarks).toEqual(['cis_lvl1', 'cis_lvl2'])
  })
})

describe('buildHistoryIndex file names', () => {
  it('fails with a clear error when a rule is stored under another file name in another release', () => {
    const renamed = { ...rule('steady', 'R2'), file: 'rules/steady-renamed.json' }
    const rulesByTag = new Map([
      ['R1', [rule('steady', 'R1')]],
      ['R2', [renamed]],
    ])

    expect(() => buildHistoryIndex(SOURCE, rulesByTag)).toThrow(/mscp\.steady.*rules\/steady\.json.*rules\/steady-renamed\.json/)
  })
})

describe('compareReleases', () => {
  const ids = (entries: { id: string }[]) => entries.map((entry) => entry.id)

  it('groups rules into added, removed and changed and counts the unchanged ones', () => {
    const comparison = compareReleases(buildFixture(), 'R1', 'R3')

    expect(comparison.added.map((entry) => entry.id)).toEqual(['mscp.fresh'])
    expect(comparison.removed.map((entry) => entry.id)).toEqual(['mscp.dropped'])
    expect(comparison.changed.map((entry) => [entry.id, entry.kinds])).toEqual([
      ['mscp.gappy', ['references']],
      ['mscp.retitled', ['wording']],
    ])
    expect(ids(comparison.unchanged)).toEqual(['mscp.reverted', 'mscp.steady'])
  })

  it('shows the title of a removed rule from the release it was last in', () => {
    const comparison = compareReleases(buildFixture(), 'R1', 'R3')

    expect(comparison.removed[0]).toMatchObject({ id: 'mscp.dropped', title: 'Dropped rule', section: 'os' })
  })

  it('leaves out a rule whose change was reverted between the two releases', () => {
    const comparison = compareReleases(buildFixture(), 'R1', 'R3')

    expect(comparison.changed.map((entry) => entry.id)).not.toContain('mscp.reverted')
    expect(comparison.unchanged.map((entry) => entry.id)).toContain('mscp.reverted')
  })

  it('shows the intermediate change when comparing a neighbouring pair', () => {
    const comparison = compareReleases(buildFixture(), 'R1', 'R2')

    expect(comparison.changed.map((entry) => [entry.id, entry.kinds])).toEqual([['mscp.reverted', ['behaviour']]])
  })

  it('from the empty release lists every rule in To as added and nothing else', () => {
    const comparison = compareReleases(buildFixture(), EMPTY_RELEASE_TAG, 'R3')

    expect(ids(comparison.added)).toEqual(['mscp.fresh', 'mscp.gappy', 'mscp.retitled', 'mscp.reverted', 'mscp.steady'])
    expect(comparison.removed).toEqual([])
    expect(comparison.changed).toEqual([])
    expect(comparison.unchanged).toEqual([])
  })

  it('from the empty release leaves out rules absent from To', () => {
    const comparison = compareReleases(buildFixture(), EMPTY_RELEASE_TAG, 'R1')

    expect(ids(comparison.added)).not.toContain('mscp.fresh')
    expect(ids(comparison.added)).toContain('mscp.dropped')
  })

  it('from the empty release still rejects an unknown To', () => {
    expect(() => compareReleases(buildFixture(), EMPTY_RELEASE_TAG, 'R9')).toThrow(/R9/)
  })

  it('sorts every group by id', () => {
    const comparison = compareReleases(buildFixture(), 'R1', 'R3')

    for (const group of [comparison.added, comparison.removed, comparison.changed, comparison.unchanged]) {
      expect(group.map((entry) => entry.id)).toEqual([...group.map((entry) => entry.id)].sort())
    }
  })

  it('throws unless the from release is before the to release', () => {
    expect(() => compareReleases(buildFixture(), 'R3', 'R1')).toThrow(/before/)
    expect(() => compareReleases(buildFixture(), 'R2', 'R2')).toThrow(/before/)
  })

  it('throws for a release the index does not list', () => {
    expect(() => compareReleases(buildFixture(), 'R1', 'missing')).toThrow(/missing/)
  })
})

function states(timeline: TimelineEntry[]): string[] {
  return timeline.map((entry) => entry.state)
}

describe('ruleTimeline', () => {
  it('lists the newest release first', () => {
    const timeline = ruleTimeline(buildFixture(), 'mscp.steady')

    expect(timeline.map((entry) => entry.tag)).toEqual(['R3', 'R2', 'R1'])
    expect(timeline[0].label).toBe('Release R3')
  })

  it('shows a reverted change as two changes even though the end points match', () => {
    const timeline = ruleTimeline(buildFixture(), 'mscp.reverted')

    expect(states(timeline)).toEqual(['changed', 'changed', 'earliest'])
    expect(timeline[0].kinds).toEqual(['behaviour'])
    expect(changeCount(timeline)).toBe(2)
  })

  it('marks releases without a change as unchanged', () => {
    expect(states(ruleTimeline(buildFixture(), 'mscp.steady'))).toEqual(['unchanged', 'unchanged', 'earliest'])
  })

  it('shows removed and added around a gap, with no unchanged entry inside it', () => {
    const timeline = ruleTimeline(buildFixture(), 'mscp.gappy')

    expect(states(timeline)).toEqual(['added', 'removed', 'earliest'])
    expect(changeCount(timeline)).toBe(2)
  })

  it('shows a rule that only exists in older releases as removed, then absent', () => {
    const timeline = ruleTimeline(buildFixture(), 'mscp.dropped')

    expect(states(timeline)).toEqual(['absent', 'removed', 'earliest'])
  })

  it('marks the first release of a rule that appeared later as added, with absent before it', () => {
    expect(states(ruleTimeline(buildFixture(), 'mscp.fresh'))).toEqual(['unchanged', 'added', 'absent'])
  })

  it('gives an empty timeline for a rule the index does not know', () => {
    expect(ruleTimeline(buildFixture(), 'mscp.unknown')).toEqual([])
  })
})

describe('foldQuietRuns', () => {
  const entry = (tag: string, state: TimelineEntry['state']): TimelineEntry => ({ tag, label: tag, state, kinds: [] })

  it('folds consecutive unchanged releases into one quiet item', () => {
    const items = foldQuietRuns([entry('R5', 'changed'), entry('R4', 'unchanged'), entry('R3', 'unchanged'), entry('R2', 'changed'), entry('R1', 'earliest')])

    expect(items.map((item) => item.type)).toEqual(['entry', 'quiet', 'entry', 'entry'])
    expect(items[1]).toEqual({ type: 'quiet', entries: [entry('R4', 'unchanged'), entry('R3', 'unchanged')] })
  })

  it('folds consecutive absent releases separately from unchanged ones', () => {
    const items = foldQuietRuns([entry('R4', 'absent'), entry('R3', 'absent'), entry('R2', 'unchanged'), entry('R1', 'earliest')])

    expect(items.map((item) => item.type)).toEqual(['quiet', 'quiet', 'entry'])
  })

  describe('with some kinds of change hidden', () => {
    const changedIn = (tag: string, kinds: ChangeKind[]): TimelineEntry => ({ tag, label: tag, state: 'changed', kinds })
    const behaviourAndScope: ReadonlySet<ChangeKind> = new Set<ChangeKind>(['behaviour', 'scope'])

    it('folds a release whose changes are all hidden together with the unchanged releases around it', () => {
      const items = foldQuietRuns(
        [changedIn('R5', ['behaviour']), changedIn('R4', ['wording']), entry('R3', 'unchanged'), changedIn('R2', ['references', 'wording']), entry('R1', 'earliest')],
        behaviourAndScope,
      )

      expect(items.map((item) => item.type)).toEqual(['entry', 'quiet', 'entry'])
      expect(items[1]).toMatchObject({ type: 'quiet', entries: [{ tag: 'R4' }, { tag: 'R3' }, { tag: 'R2' }] })
    })

    it('keeps a release with at least one shown kind', () => {
      const items = foldQuietRuns([changedIn('R2', ['wording', 'scope']), entry('R1', 'earliest')], behaviourAndScope)

      expect(items.map((item) => item.type)).toEqual(['entry', 'entry'])
    })

    it('still keeps absent runs apart and never folds added or removed releases', () => {
      const items = foldQuietRuns([entry('R5', 'added'), entry('R4', 'absent'), changedIn('R3', ['wording']), entry('R2', 'removed'), entry('R1', 'earliest')], behaviourAndScope)

      expect(items.map((item) => item.type)).toEqual(['entry', 'quiet', 'quiet', 'entry', 'entry'])
    })
  })

  it('never folds a change', () => {
    const items = foldQuietRuns([entry('R3', 'changed'), entry('R2', 'added'), entry('R1', 'removed')])

    expect(items.every((item) => item.type === 'entry')).toBe(true)
  })
})

describe('parseHistoryIndex', () => {
  it('accepts what buildHistoryIndex produces, after a JSON round trip', () => {
    const index = buildFixture()

    expect(parseHistoryIndex(JSON.parse(JSON.stringify(index)))).toEqual(index)
  })

  it('rejects a wrong schema_version', () => {
    expect(parseHistoryIndex({ ...buildFixture(), schema_version: 2 })).toEqual({ error: expect.stringContaining('schema_version') })
  })

  it('rejects a rule whose versions are not aligned with the releases', () => {
    const index = buildFixture()
    index.rules['mscp.steady'].versions.pop()

    expect(parseHistoryIndex(JSON.parse(JSON.stringify(index)))).toEqual({ error: expect.stringContaining('mscp.steady') })
  })

  it('rejects something that is not an object', () => {
    expect(parseHistoryIndex(null)).toEqual({ error: expect.any(String) })
  })
})

describe('previousTagWithRule', () => {
  it('finds the closest earlier release that has the rule, skipping a gap', () => {
    const index = buildFixture()

    expect(previousTagWithRule(index, 'mscp.gappy', 'R3')).toBe('R1')
    expect(previousTagWithRule(index, 'mscp.steady', 'R3')).toBe('R2')
  })

  it('is null for the first release of a rule and for an unknown rule or release', () => {
    const index = buildFixture()

    expect(previousTagWithRule(index, 'mscp.fresh', 'R2')).toBeNull()
    expect(previousTagWithRule(index, 'mscp.steady', 'R1')).toBeNull()
    expect(previousTagWithRule(index, 'mscp.unknown', 'R3')).toBeNull()
    expect(previousTagWithRule(index, 'mscp.steady', 'R9')).toBeNull()
  })
})

describe('latestReleaseWithRule and ruleFilePathAtRelease', () => {
  it('finds the newest release that has the rule, even when it was dropped later', () => {
    const index = buildFixture()

    expect(latestReleaseWithRule(index, 'mscp.dropped')?.tag).toBe('R1')
    expect(latestReleaseWithRule(index, 'mscp.steady')?.tag).toBe('R3')
    expect(latestReleaseWithRule(index, 'mscp.unknown')).toBeNull()
  })

  it('names the rule file under baselines/ for a release that has the rule', () => {
    const index = buildFixture()

    expect(ruleFilePathAtRelease(index, 'mscp.steady', 'R2')).toBe('mscp/releases/R2/rules/steady.json')
  })

  it('has no path for a release without the rule, or an unknown rule or release', () => {
    const index = buildFixture()

    expect(ruleFilePathAtRelease(index, 'mscp.fresh', 'R1')).toBeNull()
    expect(ruleFilePathAtRelease(index, 'mscp.unknown', 'R1')).toBeNull()
    expect(ruleFilePathAtRelease(index, 'mscp.steady', 'R9')).toBeNull()
  })
})
