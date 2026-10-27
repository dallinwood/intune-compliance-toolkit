import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { targetIconsOf } from '../../logic/targetIcons'

// Icons are not focusable (the tooltip is a hover extra; the accessible name
// carries the information), so they add no tab stops across 1,493 rows.
export function TargetIcons({ targetKeys }: { targetKeys: readonly string[] }) {
  return targetIconsOf(targetKeys).map(({ targetName, icon: Icon, label }) => (
    <Tooltip key={targetName}>
      <TooltipTrigger render={<span role="img" aria-label={label} />} className="inline-flex shrink-0 text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  ))
}
