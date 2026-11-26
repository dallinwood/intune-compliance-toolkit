import { ArrowUpRight } from 'lucide-react'
import type { MouseEvent } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { upstreamRuleId } from '../../logic/ruleDisplay'
import { filtersShowingRule } from '../../logic/ruleNavigation'
import { useFilterStore } from '../../state/filterStore'
import { useRuleMappings } from '../../state/mappingsContext'
import { DEFAULT_AUTOMATION, DEFAULT_PAGE_SIZE, ALL_FRAMEWORKS, DEFAULT_VIEW_ID, parseUrlState, serializeUrlLocation } from '../../state/urlState'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { RuleRow } from '../../types/rule-row'

// What a new tab or a copied link opens: just the search and the open rule.
// A plain click keeps every filter that does not hide the rule instead.
function hrefShowing(ruleId: string): string {
  const state = {
    ...parseUrlState(''),
    view: DEFAULT_VIEW_ID,
    framework: ALL_FRAMEWORKS,
    frameworkTab: 'rules' as const,
    search: upstreamRuleId(ruleId),
    openRule: ruleId,
  }
  return serializeUrlLocation(state, { automation: DEFAULT_AUTOMATION, size: DEFAULT_PAGE_SIZE }, import.meta.env.BASE_URL)
}

function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

// Opens the rule in the rules table. onNavigate runs after a plain click, so
// whatever showed the link (a dialog, the review screen) can get out of the way.
export function GoToRuleLink({ row, onNavigate }: { row: RuleRow; onNavigate?: () => void }) {
  const { linkedFrameworks } = useRuleMappings()
  const vocabularyIndex = useVocabularyIndex()
  const showRule = useFilterStore((store) => store.showRule)

  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (!isPlainClick(event)) return
    event.preventDefault()
    const currentState = useFilterStore.getState()
    // A framework page only lists its own rules, so a rule from another framework opens on the all-rules page.
    const framework = currentState.framework === row.sourceName ? row.sourceName : ALL_FRAMEWORKS
    showRule(row.ref.id, filtersShowingRule(row, currentState, vocabularyIndex, linkedFrameworks), framework)
    onNavigate?.()
  }

  return (
    <a href={hrefShowing(row.ref.id)} onClick={navigate} className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'shrink-0')}>
      Go to this rule
      <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
    </a>
  )
}
