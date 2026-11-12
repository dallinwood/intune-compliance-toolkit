import { fetchHistoryIndex, fetchRuleAtRelease } from './history'
import { fetchOverlayById } from './ruleDetail'
import {
  customChangeBaseline,
  customChangeNotice,
  customChangeStatus,
  overlayFieldPaths,
  type CustomChangeNotice,
  type CustomChangeStatus,
} from '../logic/customChangeNotice'
import type { OverlayApplication } from '../logic/overlays'
import { fieldChanges } from '../logic/ruleChanges'
import type { VocabularyIndex } from '../logic/vocabulary'
import type { Rule } from '../types/library'

export interface CustomChangeComparison {
  status: CustomChangeStatus
  notice: CustomChangeNotice
  fromTag: string
  toTag: string
  focusPaths: string[][]
  releaseLabel: string
}

// Whether a rule changed since the release an overlay was written for, in a field
// the overlay touches. Fetches the history, the overlay and the two rule files;
// rejects when any of them cannot be read or the rule is not in the baseline release.
export async function loadCustomChangeStatus(
  rule: Rule,
  application: OverlayApplication,
  vocabularyIndex: VocabularyIndex,
): Promise<CustomChangeComparison> {
  const [history, overlay] = await Promise.all([fetchHistoryIndex(rule.source.name), fetchOverlayById(application.overlayId)])
  const baseline = customChangeBaseline(history, application.release)
  const toTag = rule.source.release_tag
  const [before, after] = await Promise.all([fetchRuleAtRelease(history, rule.id, baseline.fromTag), fetchRuleAtRelease(history, rule.id, toTag)])
  const focusPaths = overlayFieldPaths(overlay.fields)
  const status = customChangeStatus(fieldChanges(before, after), focusPaths, vocabularyIndex)
  const labelOf = (tag: string) => history.releases.find((release) => release.tag === tag)?.label ?? tag
  const releaseLabel = baseline.inHistory ? labelOf(application.release) : application.release
  const notice = customChangeNotice(status, {
    releaseLabel,
    earliestLabel: labelOf(baseline.fromTag),
    inHistory: baseline.inHistory,
  })
  return { status, notice, fromTag: baseline.fromTag, toTag, focusPaths, releaseLabel }
}
