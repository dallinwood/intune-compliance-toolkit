import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { CheckStatus } from '../../logic/ruleStatusIcons'
import { targetIconsOf } from '../../logic/targetIcons'
import { StatusGlyph } from './StatusGlyph'

interface TargetIconsProps {
  targetKeys: readonly string[]
  // When given, each icon is coloured by its target's status and carries the
  // status mark; without it the icons stay muted labels.
  statusByTarget?: Readonly<Record<string, CheckStatus>>
}

// The markup is trusted package content (bootstrap-icons), not user input.
// Icons are not focusable (the tooltip is a hover extra; the accessible name
// carries the information), so they add no tab stops across 1,493 rows.
export function TargetIcons({ targetKeys, statusByTarget }: TargetIconsProps) {
  return targetIconsOf(targetKeys).map(({ targetName, svgMarkup, label }) => {
    const status = statusByTarget?.[targetName]
    const accessibleName = status ? `${label}: ${status} check` : label
    return (
      <Tooltip key={targetName}>
        <TooltipTrigger
          render={<span role="img" aria-label={accessibleName} />}
          className={`inline-flex shrink-0 ${status ? '' : 'text-muted-foreground [&>svg]:size-4'}`}
        >
          {status ? (
            <StatusGlyph glyphMarkup={svgMarkup} status={status} />
          ) : (
            <span className="contents" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
          )}
        </TooltipTrigger>
        <TooltipContent>{accessibleName}</TooltipContent>
      </Tooltip>
    )
  })
}
