import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { targetIconsOf } from '../../logic/targetIcons'

// The markup is trusted package content (bootstrap-icons), not user input.
// Icons are not focusable (the tooltip is a hover extra; the accessible name
// carries the information), so they add no tab stops across 1,493 rows.
export function TargetIcons({ targetKeys }: { targetKeys: readonly string[] }) {
  return targetIconsOf(targetKeys).map(({ targetName, svgMarkup, label }) => (
    <Tooltip key={targetName}>
      <TooltipTrigger render={<span role="img" aria-label={label} />} className="inline-flex shrink-0 text-muted-foreground [&>svg]:size-4">
        <span className="contents" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  ))
}
