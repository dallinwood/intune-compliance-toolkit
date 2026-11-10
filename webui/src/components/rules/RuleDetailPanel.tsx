import { Tabs } from '@base-ui/react/tabs'
import { Component, useEffect, useState, type ReactNode } from 'react'
import { useImportedRule, useRule, useStoredOdvValue, type RuleLoadState } from '@/hooks/useRule'
import { useRuleHistory } from '@/hooks/useRuleHistory'
import { useCustomChangeNotice } from '@/hooks/useCustomChangeNotice'
import { useSourceReleaseCount } from '@/hooks/useSourceReleaseCount'
import { changeCount } from '../../logic/historyIndex'
import { historyTabLabel } from '../../logic/changeLabels'
import { distinctMappedRuleCount } from '../../logic/mappedRuleView'
import { termLabel } from '../../logic/vocabulary'
import { displayWithOdv, odvSubstitutionMode, codeOdvValues, usableOdvValue, validateOdvValue } from '../../logic/odv'
import type { OverlaidRule, OverlayApplication } from '../../logic/overlays'
import { macosReferences } from '../../logic/references'
import { BREADCRUMB_SEPARATOR } from '../../logic/ruleDisplay'
import type { RuleRef } from '../../logic/selectionEntry'
import { showsRemediationSection } from '../../logic/targetDisplay'
import { useRuleMappings } from '../../state/mappingsContext'
import { useMappedRulesViewState, type MappedRulesViewState } from '../../state/mappedRulesView'
import { useFilterStore } from '../../state/filterStore'
import { useSelectionStore } from '../../state/selectionStore'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { Rule, RuleSource } from '../../types/library'
import { RuleHistoryTab, type HistoryCompare } from '../history/RuleHistoryTab'
import { SectionHeading } from './CodeBlock'
import { CustomTag } from './CustomTag'
import { DiscussionText } from './DiscussionText'
import { MappedRulesTab } from './MappedRulesTab'
import { OrgDefinedValueInput } from './OrgDefinedValueInput'
import { RuleBenchmarks } from './RuleBenchmarks'
import { RuleCheckSection } from './RuleCheckSection'
import { RuleReferences } from './RuleReferences'
import { RuleRemediationSection } from './RuleRemediationSection'

const PANEL_CLASS = 'border-t border-border bg-panel p-4 text-sm'

// Only the parts the source provides: mSCP rules have neither, an ISM control
// has both.
function revisionLine(source: RuleSource): string | null {
  const parts = [
    source.upstream_revision !== null ? `Revision ${source.upstream_revision}` : null,
    source.upstream_updated !== null ? `updated ${source.upstream_updated}` : null,
  ].filter((part) => part !== null)
  return parts.length > 0 ? parts.join(', ') : null
}

// No error boundary sits higher up, so a render failure here would blank the
// whole app; this one keeps it to the panel.
class DetailErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

// A nested panel (a mapped rule's details shown inside another rule's) has no
// tabs and no mapped rules, so nesting stops at one level.
export function RuleDetailPanel({ ruleRef, nested = false }: { ruleRef: RuleRef; nested?: boolean }) {
  const mappedView = useMappedRulesViewState()
  const tabState = nested ? undefined : mappedView
  const failedEntirely = <p className={`${PANEL_CLASS} text-destructive`}>These details could not be displayed.</p>
  return (
    <DetailErrorBoundary
      fallback={
        <DetailErrorBoundary fallback={failedEntirely}>
          <ImportedRuleDetail ruleRef={ruleRef} mappedView={tabState} />
        </DetailErrorBoundary>
      }
    >
      <OverlaidRuleDetail ruleRef={ruleRef} mappedView={tabState} />
    </DetailErrorBoundary>
  )
}

function OverlaidRuleDetail({ ruleRef, mappedView }: { ruleRef: RuleRef; mappedView?: MappedRulesViewState }) {
  return <RuleDetailFor ruleRef={ruleRef} ruleState={useRule(ruleRef)} mappedView={mappedView} />
}

function ImportedRuleDetail({ ruleRef, mappedView }: { ruleRef: RuleRef; mappedView?: MappedRulesViewState }) {
  return (
    <RuleDetailFor
      ruleRef={ruleRef}
      mappedView={mappedView}
      ruleState={useImportedRule(ruleRef)}
      notice="Custom content for this rule could not be displayed, so it is shown as imported."
    />
  )
}

function RuleDetailFor({
  ruleRef,
  ruleState,
  notice,
  mappedView,
}: {
  ruleRef: RuleRef
  ruleState: RuleLoadState
  notice?: string
  mappedView?: MappedRulesViewState
}) {
  if (ruleState.status === 'loading') {
    return <p className={`${PANEL_CLASS} text-muted-foreground`}>Loading details…</p>
  }
  if (ruleState.status === 'error') {
    return <p className={`${PANEL_CLASS} text-destructive`}>Failed to load: {ruleState.message}</p>
  }
  // Keyed by the rule, so the open tab and the loaded history never carry over to another rule.
  return <LoadedRuleDetail key={ruleState.rule.id} ruleRef={ruleRef} rule={ruleState.rule} overlaid={ruleState.overlaid} notice={notice} mappedView={mappedView} />
}

// Overlaid top-level fields shown with a Custom tag on their own section;
// any other overlaid field is listed on the "Custom:" line instead.
function fieldsWithOwnSection(rule: Rule): Set<string> {
  const fields = new Set(['title', 'check', 'applicability'])
  if (rule.odv) fields.add('odv')
  if (showsRemediationSection(rule)) fields.add('remediation')
  if (macosReferences(rule.references).length > 0) fields.add('references')
  return fields
}

// The notice that a rule's custom changes were written for an older release: whether
// the rule changed since in a field they touch, with a way to see the changes.
// Falls back to the plain review note when the history cannot say.
function StaleOverlayNote({
  application,
  rule,
  onSeeWhatChanged,
}: {
  application: OverlayApplication
  rule: Rule
  onSeeWhatChanged?: (compare: HistoryCompare) => void
}) {
  const vocabularyIndex = useVocabularyIndex()
  const sourceLabel = termLabel(vocabularyIndex, 'sources', rule.source.name)
  const state = useCustomChangeNotice(rule, application)
  if (state.status === 'loading') {
    return (
      <p data-testid="stale-overlay-note" className="break-words text-muted-foreground">
        Checking whether this rule changed since your custom changes were written…
      </p>
    )
  }
  if (state.status === 'unknown') {
    return (
      <p data-testid="stale-overlay-note" className="break-words">
        Custom content ({application.overlayId}) was written for {sourceLabel} {application.release}; this rule is from {rule.source.release_tag}. Review it
        for accuracy.
      </p>
    )
  }
  const { notice, fromTag, toTag, focusPaths } = state
  return (
    <p data-testid="stale-overlay-note" className={`break-words ${notice.tone === 'warning' ? '' : 'text-muted-foreground'}`}>
      {notice.lead !== null && <strong>{notice.lead} </strong>}
      {notice.text}
      {notice.linksToChanges && onSeeWhatChanged !== undefined && (
        <>
          {' '}
          <button
            type="button"
            onClick={() => onSeeWhatChanged({ from: fromTag, to: toTag, focusPaths })}
            className="rounded-sm text-link underline focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
          >
            See what changed →
          </button>
        </>
      )}
    </p>
  )
}

function OverlayNotes({ overlaid, rule, onSeeWhatChanged }: { overlaid: OverlaidRule; rule: Rule; onSeeWhatChanged?: (compare: HistoryCompare) => void }) {
  const staleOverlays = overlaid.applied.filter((application) => application.stale)
  if (staleOverlays.length === 0 && overlaid.skipped.length === 0) return null

  return (
    <div className="space-y-1 text-xs text-warning-foreground">
      {overlaid.skipped.map((skipped) => (
        <p key={skipped.overlayId} data-testid="skipped-overlay-note" className="break-words">
          Custom content ({skipped.overlayId}) could not be applied to this rule and was skipped: {skipped.message}
        </p>
      ))}
      {staleOverlays.map((application) => (
        <StaleOverlayNote key={application.overlayId} application={application} rule={rule} onSeeWhatChanged={onSeeWhatChanged} />
      ))}
    </div>
  )
}

const TAB_CLASS =
  'border-b-2 border-transparent px-3 py-1.5 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring data-active:border-primary data-active:text-foreground'

const PANEL_FOCUS_CLASS = 'outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'

type PanelTab = 'details' | 'mapped-rules' | 'history'

function LoadedRuleDetail({
  ruleRef,
  rule,
  overlaid,
  notice,
  mappedView,
}: {
  ruleRef: RuleRef
  rule: Rule
  overlaid: OverlaidRule
  notice?: string
  mappedView?: MappedRulesViewState
}) {
  const { byRule, rowsById } = useRuleMappings()
  // A link from a release comparison can ask for the History tab.
  const requestedTab = useFilterStore((store) => (store.openRule === rule.id ? store.openRuleTab : null))
  const [tab, setTab] = useState<PanelTab>(requestedTab ?? 'details')
  // Set by "See what changed" in a custom changes notice: the releases and fields to open History on.
  const [historyCompare, setHistoryCompare] = useState<HistoryCompare | undefined>(undefined)
  useEffect(() => {
    if (requestedTab !== null) setTab(requestedTab)
  }, [requestedTab])
  // Nested panels (a mapped rule's details) show no History tab.
  const history = useRuleHistory(mappedView ? rule : null)
  // The manifest already says whether there is a history, so the tab is there from the first render.
  const releaseCount = useSourceReleaseCount(mappedView ? rule.source.name : null)
  const showHistory = (releaseCount ?? 0) > 1
  const mappedRuleCount = mappedView ? distinctMappedRuleCount(byRule.get(rule.id) ?? [], rowsById) : 0
  const storedValue = useStoredOdvValue(ruleRef)
  const setOdvValue = useSelectionStore((store) => store.setOdvValue)
  const clearOdvValue = useSelectionStore((store) => store.clearOdvValue)
  const vocabularyIndex = useVocabularyIndex()
  const mode = odvSubstitutionMode(rule)
  // An invalid saved value blocks generation, so the details show the
  // placeholder rather than a recommended value that will not be used.
  const storedValueIsInvalid =
    rule.odv !== null && storedValue !== null && validateOdvValue(rule.odv, storedValue, mode, rule.id) !== null
  const odvValue = storedValueIsInvalid ? null : usableOdvValue(rule.odv, mode, storedValue, rule.id)
  const codeOdv = codeOdvValues(rule.odv, mode, odvValue, rule.id)
  const { source } = rule
  const revision = revisionLine(source)
  // A one-level path (every mSCP rule) only repeats the table's group header
  // as a raw folder code.
  const showBreadcrumb = rule.section_path.length > 1
  const { provenance } = overlaid
  const isCustom = (field: string) => provenance.has(field)
  const ownSections = fieldsWithOwnSection(rule)
  const customLineFields = [...provenance.keys()].filter((field) => !ownSections.has(field))

  const detailContent = (
    <>
      {notice && <p className="text-xs break-words text-warning-foreground">{notice}</p>}
      <OverlayNotes
        overlaid={overlaid}
        rule={rule}
        onSeeWhatChanged={
          mappedView && showHistory
            ? (compare) => {
                setHistoryCompare(compare)
                setTab('history')
              }
            : undefined
        }
      />

      {isCustom('title') && (
        <p data-testid="custom-title" className="font-medium break-words text-foreground">
          {displayWithOdv(rule.title, odvValue)} <CustomTag className="ml-1 align-text-bottom" />
        </p>
      )}

      {(showBreadcrumb || revision) && (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {showBreadcrumb && (
            <p data-testid="rule-breadcrumb" className="break-words">
              {rule.section_path.join(BREADCRUMB_SEPARATOR)}
            </p>
          )}
          {revision && <p>{revision}</p>}
        </div>
      )}

      <DiscussionText text={rule.discussion} format={rule.discussion_format} odvValue={odvValue} codeOdv={codeOdv} />

      {rule.odv && (
        <div className="space-y-1">
          <SectionHeading custom={isCustom('odv')}>Organization-defined value</SectionHeading>
          <OrgDefinedValueInput
            ruleId={rule.id}
            odv={rule.odv}
            mode={mode}
            storedValue={storedValue}
            onCommit={(value) => setOdvValue(ruleRef, value)}
            onClear={() => clearOdvValue(ruleRef)}
          />
        </div>
      )}

      <RuleCheckSection rule={rule} odvValue={odvValue} codeOdv={codeOdv} custom={isCustom('check')} />
      <RuleRemediationSection rule={rule} odvValue={odvValue} codeOdv={codeOdv} custom={isCustom('remediation')} />
      <RuleBenchmarks applicability={rule.applicability} custom={isCustom('applicability')} />
      <RuleReferences references={rule.references} custom={isCustom('references')} />

      {customLineFields.length > 0 && (
        <p data-testid="custom-fields" className="text-xs break-words text-custom-foreground">
          Custom: {customLineFields.join(', ')}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        From{' '}
        <a className="text-link underline" href={source.upstream_url} target="_blank" rel="noreferrer">
          {termLabel(vocabularyIndex, 'sources', source.name)} {source.release_tag}
        </a>{' '}
        ({source.upstream_rule_id}), licensed{' '}
        <a className="text-link underline" href={source.license.url} target="_blank" rel="noreferrer">
          {source.license.name}
        </a>
        , modified for this tool.
      </p>
    </>
  )

  return (
    <div className={`space-y-4 ${PANEL_CLASS}`}>
      {mappedView && (mappedRuleCount > 0 || showHistory) ? (
        <Tabs.Root value={tab} onValueChange={(value) => setTab(value as PanelTab)} className="space-y-4">
          <Tabs.List className="flex flex-wrap border-b border-border">
            <Tabs.Tab value="details" className={TAB_CLASS}>
              Details
            </Tabs.Tab>
            {mappedRuleCount > 0 && (
              <Tabs.Tab value="mapped-rules" className={TAB_CLASS}>
                Mapped rules ({mappedRuleCount})
              </Tabs.Tab>
            )}
            {showHistory && (
              <Tabs.Tab value="history" className={TAB_CLASS}>
                {historyTabLabel(history.status === 'ready' ? changeCount(history.timeline) : null)}
              </Tabs.Tab>
            )}
          </Tabs.List>
          <Tabs.Panel value="details" keepMounted className={`space-y-4 ${PANEL_FOCUS_CLASS}`}>
            {detailContent}
          </Tabs.Panel>
          {mappedRuleCount > 0 && (
            <Tabs.Panel value="mapped-rules" className={PANEL_FOCUS_CLASS}>
              <MappedRulesTab ruleId={rule.id} view={mappedView} />
            </Tabs.Panel>
          )}
          {showHistory && (
            <Tabs.Panel value="history" className={PANEL_FOCUS_CLASS}>
              {history.status === 'loading' && <p className="text-sm text-muted-foreground">Loading history…</p>}
              {history.status === 'error' && <p className="text-sm text-destructive">Failed to load: {history.message}</p>}
              {history.status === 'ready' && (
                <RuleHistoryTab
                  key={historyCompare === undefined ? 'no-compare' : `${historyCompare.from}>${historyCompare.to}`}
                  ruleId={rule.id}
                  index={history.index}
                  timeline={history.timeline}
                  initialCompare={historyCompare}
                />
              )}
            </Tabs.Panel>
          )}
        </Tabs.Root>
      ) : (
        detailContent
      )}
    </div>
  )
}
