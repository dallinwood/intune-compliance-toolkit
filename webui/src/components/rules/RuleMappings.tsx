import { useId, type MouseEvent } from 'react'
import { useDisplayTitle } from '../../hooks/useDisplayTitle'
import { groupMappedRules, staleEndpoints, type MappedRule } from '../../logic/mappingIndex'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { filtersShowingRule } from '../../logic/ruleNavigation'
import { termLabel, type VocabularyIndex } from '../../logic/vocabulary'
import { useFilterStore } from '../../state/filterStore'
import { useRuleMappings } from '../../state/mappingsContext'
import { DEFAULT_AUTOMATION, DEFAULT_PAGE_SIZE, parseUrlState, serializeUrlState } from '../../state/urlState'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { RuleRow } from '../../types/rule-row'
import { SectionHeading } from './CodeBlock'

// What a new tab or a copied link opens: just the search and the open rule.
// A plain click keeps every filter that does not hide the rule instead.
function hrefShowing(ruleId: string): string {
  const state = { ...parseUrlState(''), search: upstreamRuleId(ruleId), openRule: ruleId }
  return `${window.location.pathname}${serializeUrlState(state, { automation: DEFAULT_AUTOMATION, size: DEFAULT_PAGE_SIZE })}`
}

function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

export function RuleMappings({ ruleId }: { ruleId: string }) {
  const { byRule, rowsById } = useRuleMappings()
  const index = useVocabularyIndex()
  const headingIdPrefix = useId()
  const links = byRule.get(ruleId) ?? []
  const self = rowsById.get(ruleId)
  if (links.length === 0 || !self) return null

  return (
    <section aria-label="Mapped rules" className="space-y-1">
      <SectionHeading>Mapped rules</SectionHeading>
      <div className="space-y-2 text-xs">
        {groupMappedRules(links).map((group, groupPosition) => {
          const headingId = `${headingIdPrefix}-${groupPosition}`
          return (
            <div key={group.label} data-testid="mapping-group">
              <p id={headingId} className="font-medium text-foreground/80">
                {group.label}
              </p>
              <ul aria-labelledby={headingId} className="mt-0.5 space-y-1.5">
                {group.links.map((link) => {
                  const other = rowsById.get(link.rule)
                  return other ? <MappedRuleItem key={link.rule} link={link} self={self} other={other} index={index} /> : null
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function MappedRuleItem({ link, self, other, index }: { link: MappedRule; self: RuleRow; other: RuleRow; index: VocabularyIndex }) {
  const showRule = useFilterStore((store) => store.showRule)
  const otherSourceLabel = termLabel(index, 'sources', other.sourceName)
  const otherUpstreamId = upstreamRuleId(other.ref.id)
  const otherTitle = useDisplayTitle(other)
  const stale = staleEndpoints(
    link,
    { ruleId: self.ref.id, sourceName: self.sourceName, releaseTag: self.releaseTag },
    { sourceName: other.sourceName, releaseTag: other.releaseTag },
  )

  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (!isPlainClick(event)) return
    event.preventDefault()
    showRule(other.ref.id, filtersShowingRule(other, useFilterStore.getState(), index))
  }

  return (
    <li data-testid="mapped-rule" className="break-words">
      <a
        href={hrefShowing(other.ref.id)}
        onClick={navigate}
        aria-label={`Show ${otherSourceLabel} ${otherUpstreamId}: ${otherTitle}`}
        className="group block rounded py-0.5 hover:bg-foreground/5"
      >
        <span className="text-muted-foreground">{otherSourceLabel}</span>{' '}
        <span className="font-mono break-all text-link underline underline-offset-4 group-hover:no-underline">{otherUpstreamId}</span>
        <span className="block text-foreground">{otherTitle}</span>
      </a>
      {link.note && <p className="text-muted-foreground">{link.note}</p>}
      {stale.map((endpoint) => (
        <p key={endpoint.ruleId} data-testid="stale-mapping-note" className="text-warning-foreground">
          This link was checked against {termLabel(index, 'sources', endpoint.sourceName)} {endpoint.mappedRelease} for{' '}
          {upstreamRuleId(endpoint.ruleId)}, which is now from {endpoint.currentRelease}. Review it for accuracy.
        </p>
      ))}
    </li>
  )
}
