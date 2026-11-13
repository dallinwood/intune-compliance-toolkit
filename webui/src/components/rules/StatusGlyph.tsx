import { STATUS_MARK_ICONS } from '../../logic/targetIcons'
import type { CheckStatus } from '../../logic/ruleStatusIcons'

const STATUS_COLOUR_CLASSES: Record<CheckStatus, string> = {
  automated: 'text-status-automated',
  manual: 'text-status-manual',
}

// A glyph coloured by status with its non-colour mark (check or dash) at the
// bottom-right. The markup is trusted package content (bootstrap-icons).
export function StatusGlyph({ glyphMarkup, status }: { glyphMarkup: string; status: CheckStatus }) {
  return (
    <span aria-hidden="true" className={`relative inline-flex shrink-0 ${STATUS_COLOUR_CLASSES[status]} [&_svg]:size-4`}>
      <span className="contents" dangerouslySetInnerHTML={{ __html: glyphMarkup }} />
      <span
        className="absolute -right-1 -bottom-0.5 inline-flex rounded-full bg-background ring-[1.5px] ring-background [&_svg]:size-[9px]"
        dangerouslySetInnerHTML={{ __html: STATUS_MARK_ICONS[status] }}
      />
    </span>
  )
}
