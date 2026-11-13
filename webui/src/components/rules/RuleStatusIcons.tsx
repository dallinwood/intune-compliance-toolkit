import { useMemo, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { linkStatusCounts, rowStatusIcons, stripAccessibleName, type StatusIcon } from '../../logic/ruleStatusIcons'
import { LINK_ICON, NO_TARGET_ICON, targetIconFor } from '../../logic/targetIcons'
import { useRuleMappings } from '../../state/mappingsContext'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { RuleRow } from '../../types/rule-row'
import { StatusGlyph } from './StatusGlyph'

function glyphMarkupOf(icon: StatusIcon): string {
  if (icon.kind === 'link') return LINK_ICON
  if (icon.kind === 'no-target') return NO_TARGET_ICON
  return targetIconFor(icon.targetName ?? '').svgMarkup
}

function StatusIconItem({ icon }: { icon: StatusIcon }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span role="img" aria-label={icon.label} />} className="inline-flex shrink-0">
        <StatusGlyph glyphMarkup={glyphMarkupOf(icon)} status={icon.status} />
      </TooltipTrigger>
      <TooltipContent>{icon.label}</TooltipContent>
    </Tooltip>
  )
}

// One tab stop per strip, not per icon, so thousands of rows add no extra
// stops. The strip's own tooltip opens on keyboard focus only; hovering shows
// the hovered icon's tooltip instead.
export function RuleStatusIcons({ row }: { row: RuleRow }) {
  const index = useVocabularyIndex()
  const { byRule, rowsById } = useRuleMappings()
  const [isStripTooltipOpen, setIsStripTooltipOpen] = useState(false)
  const icons = useMemo(
    () => rowStatusIcons(row, linkStatusCounts(row.ref.id, byRule, rowsById), index),
    [row, byRule, rowsById, index],
  )
  const platformIcons = icons.filter((icon) => icon.kind !== 'link')
  const linkIcons = icons.filter((icon) => icon.kind === 'link')

  return (
    <Tooltip
      open={isStripTooltipOpen}
      onOpenChange={(isOpen, eventDetails) => setIsStripTooltipOpen(!isOpen || eventDetails.reason === 'trigger-focus')}
    >
      <TooltipTrigger
        render={<span role="group" aria-label={stripAccessibleName(icons)} />}
        tabIndex={0}
        className="inline-flex items-center gap-2 rounded-sm focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
      >
        {platformIcons.map((icon) => (
          <StatusIconItem key={icon.kind + (icon.targetName ?? '')} icon={icon} />
        ))}
        {linkIcons.length > 0 && <span aria-hidden="true" className="h-4 w-px bg-border" />}
        {linkIcons.map((icon) => (
          <StatusIconItem key={`link-${icon.status}`} icon={icon} />
        ))}
      </TooltipTrigger>
      <TooltipContent>
        {icons.map((icon) => (
          <div key={icon.label}>{icon.label}</div>
        ))}
      </TooltipContent>
    </Tooltip>
  )
}
