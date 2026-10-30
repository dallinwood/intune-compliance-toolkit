import { Tabs } from '@base-ui/react/tabs'
import { Component, type ReactNode } from 'react'
import { useImportedRule, useRule, useStoredOdvValue, type RuleLoadState } from '@/hooks/useRule'
import { distinctMappedRuleCount } from '../../logic/mappedRuleView'
import { termLabel } from '../../logic/vocabulary'
import { displayWithOdv, odvSubstitutionMode, codeOdvValues, usableOdvValue, validateOdvValue } from '../../logic/odv'
import type { OverlaidRule } from '../../logic/overlays'
import { macosReferences } from '../../logic/references'
import type { RuleRef } from '../../logic/selectionEntry'
import { showsRemediationSection } from '../../logic/targetDisplay'
import { useRuleMappings } from '../../state/mappingsContext'
import { useMappedRulesViewState, type MappedRulesViewState } from '../../state/mappedRulesView'
import { useSelectionStore } from '../../state/selectionStore'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { Rule, RuleSource } from '../../types/library'
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
const BREADCRUMB_SEPARATOR = ' › '

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
  return <LoadedRuleDetail ruleRef={ruleRef} rule={ruleState.rule} overlaid={ruleState.overlaid} notice={notice} mappedView={mappedView} />
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

function OverlayNotes({ overlaid, rule }: { overlaid: OverlaidRule; rule: Rule }) {
  const vocabularyIndex = useVocabularyIndex()
  const sourceLabel = termLabel(vocabularyIndex, 'sources', rule.source.name)
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
        <p key={application.overlayId} data-testid="stale-overlay-note" className="break-words">
          Custom content ({application.overlayId}) was written for {sourceLabel} {application.release}; this rule is from{' '}
          {rule.source.release_tag}. Review it for accuracy.
        </p>
      ))}
    </div>
  )
}

const TAB_CLASS =
  'border-b-2 border-transparent px-3 py-1.5 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring data-active:border-primary data-active:text-foreground'

const PANEL_FOCUS_CLASS = 'outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'

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
      <OverlayNotes overlaid={overlaid} rule={rule} />

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
      {mappedView && mappedRuleCount > 0 ? (
        <Tabs.Root defaultValue="details" className="space-y-4">
          <Tabs.List className="flex flex-wrap border-b border-border">
            <Tabs.Tab value="details" className={TAB_CLASS}>
              Details
            </Tabs.Tab>
            <Tabs.Tab value="mapped-rules" className={TAB_CLASS}>
              Mapped rules ({mappedRuleCount})
            </Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="details" keepMounted className={`space-y-4 ${PANEL_FOCUS_CLASS}`}>
            {detailContent}
          </Tabs.Panel>
          <Tabs.Panel value="mapped-rules" className={PANEL_FOCUS_CLASS}>
            <MappedRulesTab ruleId={rule.id} view={mappedView} />
          </Tabs.Panel>
        </Tabs.Root>
      ) : (
        detailContent
      )}
    </div>
  )
}
