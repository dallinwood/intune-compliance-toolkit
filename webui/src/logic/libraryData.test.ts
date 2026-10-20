import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Manifest, Rule, RuleIndex } from '../types/library'
import { odvShellContext, validateOdvValue, type OdvShellContext } from './odv'

const BASELINES_DIRECTORY = new URL('../../../baselines/', import.meta.url)

function readBaselinesJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, BASELINES_DIRECTORY), 'utf8')) as T
}

const manifest = readBaselinesJson<Manifest>('_manifest.json')

describe('committed library data', () => {
  for (const source of manifest.sources) {
    const index = readBaselinesJson<RuleIndex>(source.index_path)
    const indexDirectory = source.index_path.slice(0, source.index_path.lastIndexOf('/') + 1)

    describe(source.name, () => {
      it.each([
        ['os_policy_banner_ssh_configure', 'double_quoted'],
        ['system_settings_softwareupdate_current', 'other'],
        ['pwpolicy_custom_regex_enforce', 'other'],
        ['system_settings_time_server_configure', 'none'],
        ['os_policy_banner_loginwindow_enforce', 'none'],
      ] as [string, OdvShellContext][])('classifies %s as %s', (upstreamRuleId, expectedContext) => {
        const rule = readBaselinesJson<Rule>(`${indexDirectory}rules/${upstreamRuleId}.json`)
        expect(odvShellContext(rule)).toBe(expectedContext)
      })

      it('has a non-empty section on every index entry', () => {
        const entriesWithoutSection = index.rules.filter((entry) => !entry.section).map((entry) => entry.id)
        expect(entriesWithoutSection).toEqual([])
      })

      it('passes validateOdvValue for every recommended and by_benchmark value', () => {
        const failures: string[] = []
        for (const entry of index.rules.filter((indexEntry) => indexEntry.has_odv)) {
          const rule = readBaselinesJson<Rule>(`${indexDirectory}${entry.file}`)
          if (!rule.odv) {
            failures.push(`${rule.id}: index says has_odv but rule has no odv`)
            continue
          }
          const context = odvShellContext(rule)
          const candidates: [string, number | string][] = [
            ['recommended', rule.odv.recommended],
            ...Object.entries(rule.odv.by_benchmark).map(([benchmark, value]): [string, number | string] => [
              `by_benchmark.${benchmark}`,
              value,
            ]),
          ]
          for (const [location, value] of candidates) {
            const reason = validateOdvValue(rule.odv, value, context)
            if (reason) failures.push(`${rule.id} ${location}=${JSON.stringify(value)}: ${reason}`)
          }
        }
        expect(failures).toEqual([])
      })
    })
  }
})
