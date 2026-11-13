import { useId, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cachedIndirectMappedRules, INDIRECT_MAPPING_DEPTH_LIMIT } from '../../logic/indirectMappings'
import {
  filterIndirectPathBlocks,
  filterMappedRuleGroups,
  groupIndirectMappedRules,
  distinctMappedRuleCount,
  groupMappedRulesBySource,
  isFilterActive,
  type AssessmentChoice,
  type MappedSourceGroup,
} from '../../logic/mappedRuleView'
import { termLabel } from '../../logic/vocabulary'
import type { MappedRulesViewState } from '../../state/mappedRulesView'
import { useRuleMappings } from '../../state/mappingsContext'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { RuleRow } from '../../types/rule-row'
import { IndirectPathBlockSection } from './IndirectMappedRules'
import { MappedSourceGroupSection, type GroupHeadingLevel } from './MappedRuleGroup'
import { StatusMessage } from '@/components/ui/status-message'

const ASSESSMENT_OPTIONS: { value: AssessmentChoice; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'automated', label: 'Automated' },
  { value: 'manual', label: 'Manual' },
]

function isAssessmentChoice(value: unknown): value is AssessmentChoice {
  return ASSESSMENT_OPTIONS.some((option) => option.value === value)
}

export function MappedRulesTab({ ruleId, view }: { ruleId: string; view: MappedRulesViewState }) {
  const { byRule, rowsById } = useRuleMappings()
  const vocabularyIndex = useVocabularyIndex()
  const links = byRule.get(ruleId)
  const self = rowsById.get(ruleId)
  const groups = useMemo(
    () => groupMappedRulesBySource(links ?? [], rowsById, (sourceName) => termLabel(vocabularyIndex, 'sources', sourceName)),
    [links, rowsById, vocabularyIndex],
  )
  const { filter, setFilter } = view
  const filtering = isFilterActive(filter)
  const visibleGroups = useMemo(() => (filtering ? filterMappedRuleGroups(groups, filter) : groups), [filtering, groups, filter])
  const indirect = useMemo(() => cachedIndirectMappedRules(ruleId, byRule), [ruleId, byRule])
  const blocks = useMemo(
    () => groupIndirectMappedRules(indirect, rowsById, (sourceName) => termLabel(vocabularyIndex, 'sources', sourceName)),
    [indirect, rowsById, vocabularyIndex],
  )
  const visibleBlocks = useMemo(() => (filtering ? filterIndirectPathBlocks(blocks, filter) : blocks), [filtering, blocks, filter])
  if (!self) return null

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Input
          type="text"
          aria-label="Filter mapped rules"
          placeholder="Filter by id or title…"
          value={filter.text}
          onChange={(event) => setFilter({ ...filter, text: event.target.value })}
          className="sm:max-w-xs"
        />
        <RadioGroup
          aria-label="Assessment"
          value={filter.assessment}
          onValueChange={(value) => {
            if (isAssessmentChoice(value)) setFilter({ ...filter, assessment: value })
          }}
          className="flex w-auto flex-wrap gap-x-4 gap-y-1"
        >
          {ASSESSMENT_OPTIONS.map((option) => (
            <AssessmentOption key={option.value} value={option.value} label={option.label} />
          ))}
        </RadioGroup>
      </div>

      {visibleGroups.length === 0 && visibleBlocks.length === 0 ? (
        <StatusMessage className="p-0">No mapped rules match these filters.</StatusMessage>
      ) : (
        <>
          {blocks.length === 0 ? (
            <DirectGroups groups={visibleGroups} self={self} filtering={filtering} view={view} headingLevel={3} />
          ) : (
            <>
              {visibleGroups.length > 0 && (
                <section className="space-y-2">
                  <h3 className="font-medium">Direct mapped rules ({distinctMappedRuleCount(links ?? [], rowsById)})</h3>
                  <DirectGroups groups={visibleGroups} self={self} filtering={filtering} view={view} headingLevel={4} />
                </section>
              )}
              {visibleBlocks.length > 0 && (
                <section className="space-y-3">
                  <h3 className="font-medium">Indirect mapped rules ({blocks.reduce((sum, block) => sum + block.total, 0)})</h3>
                  {visibleBlocks.map((block) => (
                    <IndirectPathBlockSection key={block.key} block={block} self={self} filtering={filtering} view={view} />
                  ))}
                  {indirect.truncated && (
                    <p className="text-xs text-muted-foreground">Stopped after {INDIRECT_MAPPING_DEPTH_LIMIT} levels; some further indirect links are not shown.</p>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function DirectGroups({
  groups,
  self,
  filtering,
  view,
  headingLevel,
}: {
  groups: MappedSourceGroup[]
  self: RuleRow
  filtering: boolean
  view: MappedRulesViewState
  headingLevel: GroupHeadingLevel
}) {
  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <MappedSourceGroupSection
          key={group.key}
          group={group}
          self={self}
          filtering={filtering}
          isOpen={filtering || view.openGroupKeys.has(group.key)}
          onToggle={() => view.toggleGroup(group.key)}
          view={view}
          headingLevel={headingLevel}
        />
      ))}
    </div>
  )
}

function AssessmentOption({ value, label }: { value: AssessmentChoice; label: string }) {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem id={id} value={value} />
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
    </div>
  )
}
