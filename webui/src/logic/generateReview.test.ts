import { describe, expect, it } from 'vitest'
import type { Rule } from '../types/library'
import { classifyReview, scriptedSupportingCheckIds } from './generateReview'
import { createSelectionEntry, type SelectionEntry } from './selectionEntry'
import { inlineRule, macosCheck, ruleCheck } from './testRuleFixtures'
import { committedVocabularyIndex } from './testVocabularyFixtures'

const COVERED_VERSIONS = ['27.0', '26.0', '15.0']
const vocabularyIndex = committedVocabularyIndex()

const scriptedRule = inlineRule({ upstreamId: 'os_scripted' })
const automatedButUnscriptedRule = inlineRule({ upstreamId: 'os_no_check', overrides: { check: macosCheck(ruleCheck(null, null)) } })

function selectionFor(rule: Rule): SelectionEntry {
  return { ...createSelectionEntry({ id: rule.id, path: `mscp/rules/${rule.source.upstream_rule_id}.json` }), enabled: true }
}

function classify(selected: Rule[], includedSupporting: Rule[]) {
  return classifyReview({
    selected: selected.map((rule) => ({ entry: selectionFor(rule), rule })),
    includedSupporting: includedSupporting.map((rule) => ({ ref: selectionFor(rule).ref, rule })),
    selections: {},
    coveredVersions: COVERED_VERSIONS,
    vocabularyIndex,
  })
}

describe('classifyReview scripted ids', () => {
  it('lists a selected automated rule as scripted only when it is generatable', () => {
    const classification = classify([scriptedRule, automatedButUnscriptedRule], [])

    expect(classification.scriptedSelectedRuleIds).toEqual(new Set([scriptedRule.id]))
    expect(classification.manual.map((entry) => entry.id)).toEqual([automatedButUnscriptedRule.id])
  })

  it('lists only generatable supporting checks as scripted', () => {
    const classification = classify([], [scriptedRule, automatedButUnscriptedRule])

    expect(scriptedSupportingCheckIds(classification)).toEqual(new Set([scriptedRule.id]))
  })
})
