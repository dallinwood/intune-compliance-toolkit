import { useEffect, useState } from 'react'
import { fetchHistoryIndex, fetchRuleAtRelease } from '../data/history'
import { fetchOverlayById } from '../data/ruleDetail'
import {
  customChangeBaseline,
  customChangeNotice,
  customChangeStatus,
  overlayFieldPaths,
  type CustomChangeNotice,
} from '../logic/customChangeNotice'
import { fieldChanges } from '../logic/ruleChanges'
import type { OverlayApplication } from '../logic/overlays'
import { useVocabularyIndex } from '../state/vocabularyContext'
import type { Rule } from '../types/library'

export type CustomChangeNoticeState =
  | { status: 'loading' }
  // The history or a rule file could not be read, or the rule is not in the baseline release.
  | { status: 'unknown' }
  | { status: 'ready'; notice: CustomChangeNotice; fromTag: string; toTag: string; focusPaths: string[][] }

// Whether a rule changed since the release an overlay was written for, in a field
// the overlay touches. Fetches the history, the overlay and the two rule files.
export function useCustomChangeNotice(rule: Rule, application: OverlayApplication): CustomChangeNoticeState {
  const vocabularyIndex = useVocabularyIndex()
  const key = `${rule.id}\n${application.overlayId}\n${application.release}`
  const [loaded, setLoaded] = useState<{ key: string; state: CustomChangeNoticeState } | null>(null)

  useEffect(() => {
    let cancelled = false
    async function work(): Promise<CustomChangeNoticeState> {
      const [history, overlay] = await Promise.all([fetchHistoryIndex(rule.source.name), fetchOverlayById(application.overlayId)])
      const baseline = customChangeBaseline(history, application.release)
      const toTag = rule.source.release_tag
      const [before, after] = await Promise.all([fetchRuleAtRelease(history, rule.id, baseline.fromTag), fetchRuleAtRelease(history, rule.id, toTag)])
      const focusPaths = overlayFieldPaths(overlay.fields)
      const status = customChangeStatus(fieldChanges(before, after), focusPaths, vocabularyIndex)
      const labelOf = (tag: string) => history.releases.find((release) => release.tag === tag)?.label ?? tag
      const notice = customChangeNotice(status, {
        releaseLabel: baseline.inHistory ? labelOf(application.release) : application.release,
        earliestLabel: labelOf(baseline.fromTag),
        inHistory: baseline.inHistory,
      })
      return { status: 'ready', notice, fromTag: baseline.fromTag, toTag, focusPaths }
    }
    work()
      .catch((): CustomChangeNoticeState => ({ status: 'unknown' }))
      .then((state) => {
        if (!cancelled) setLoaded({ key, state })
      })
    return () => {
      cancelled = true
    }
  }, [key, rule.id, rule.source.name, rule.source.release_tag, application.overlayId, application.release, vocabularyIndex])

  return loaded !== null && loaded.key === key ? loaded.state : { status: 'loading' }
}
