import { useEffect, useState } from 'react'
import { loadCustomChangeStatus } from '../data/customChanges'
import type { CustomChangeNotice } from '../logic/customChangeNotice'
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
    loadCustomChangeStatus(rule, application, vocabularyIndex)
      .then((comparison): CustomChangeNoticeState => ({
        status: 'ready',
        notice: comparison.notice,
        fromTag: comparison.fromTag,
        toTag: comparison.toTag,
        focusPaths: comparison.focusPaths,
      }))
      .catch((): CustomChangeNoticeState => ({ status: 'unknown' }))
      .then((state) => {
        if (!cancelled) setLoaded({ key, state })
      })
    return () => {
      cancelled = true
    }
  // The key identifies the rule and its custom changes; depending on the objects themselves would
  // refetch whenever a parent rebuilt them.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rule.id, rule.source.name, rule.source.release_tag, application.overlayId, application.release, vocabularyIndex])

  return loaded !== null && loaded.key === key ? loaded.state : { status: 'loading' }
}
