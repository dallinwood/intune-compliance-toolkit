import { LINK_ICON, NO_TARGET_ICON, targetIconFor } from '../../logic/targetIcons'
import type { CheckStatus } from '../../logic/ruleStatusIcons'
import { StatusGlyph } from './StatusGlyph'

const MACOS_MARKUP = targetIconFor('macOS').svgMarkup

const LEGEND_ENTRIES: { glyphMarkup: string; status: CheckStatus; text: string }[] = [
  { glyphMarkup: MACOS_MARKUP, status: 'automated', text: 'automated check' },
  { glyphMarkup: MACOS_MARKUP, status: 'manual', text: 'manual' },
  { glyphMarkup: NO_TARGET_ICON, status: 'manual', text: 'no platform' },
  { glyphMarkup: LINK_ICON, status: 'automated', text: 'linked to automated rules' },
  { glyphMarkup: LINK_ICON, status: 'manual', text: 'linked to manual rules' },
]

export function RuleStatusLegend() {
  return (
    <p data-testid="rule-status-legend" className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
      <span>Key:</span>
      {LEGEND_ENTRIES.map((entry) => (
        <span key={entry.text} className="inline-flex items-center gap-1.5">
          <StatusGlyph glyphMarkup={entry.glyphMarkup} status={entry.status} />
          {entry.text}
        </span>
      ))}
    </p>
  )
}
