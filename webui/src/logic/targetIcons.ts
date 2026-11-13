import appleSvg from 'bootstrap-icons/icons/apple.svg?raw'
import checkCircleFillSvg from 'bootstrap-icons/icons/check-circle-fill.svg?raw'
import clipboardSvg from 'bootstrap-icons/icons/clipboard.svg?raw'
import dashCircleFillSvg from 'bootstrap-icons/icons/dash-circle-fill.svg?raw'
import displaySvg from 'bootstrap-icons/icons/display.svg?raw'
import linkSvg from 'bootstrap-icons/icons/link.svg?raw'
import tuxSvg from 'bootstrap-icons/icons/tux.svg?raw'
import windowsSvg from 'bootstrap-icons/icons/windows.svg?raw'
import { NO_TARGET_KEY } from './applicability'
import type { CheckStatus } from './ruleStatusIcons'

export interface TargetIcon {
  svgMarkup: string
  label: string
}

// Bootstrap Icons (MIT) brand glyphs, imported as raw markup that already
// paints with currentColor, so they follow the theme's text colour.
// Adding a target is one entry here; the entries' order is the display order.
const TARGET_ICONS: Record<string, TargetIcon> = {
  macOS: { svgMarkup: appleSvg, label: 'macOS' },
  Windows: { svgMarkup: windowsSvg, label: 'Windows' },
  Linux: { svgMarkup: tuxSvg, label: 'Linux' },
}

export const NO_TARGET_ICON = clipboardSvg
export const LINK_ICON = linkSvg

// The corner mark that carries a status without colour: a check for
// automated, a dash for manual.
export const STATUS_MARK_ICONS: Record<CheckStatus, string> = {
  automated: checkCircleFillSvg,
  manual: dashCircleFillSvg,
}

const KNOWN_TARGET_NAMES = Object.keys(TARGET_ICONS)

export function targetIconFor(targetName: string): TargetIcon {
  return TARGET_ICONS[targetName] ?? { svgMarkup: displaySvg, label: targetName }
}

// The icons a row shows: known targets in map order, then unknown targets
// alphabetically. A row with no target at all (an ISM control) gets none.
export function targetIconsOf(targetKeys: readonly string[]): (TargetIcon & { targetName: string })[] {
  const targetNames = Array.from(new Set(targetKeys.filter((targetKey) => targetKey !== NO_TARGET_KEY)))
  const knownNames = KNOWN_TARGET_NAMES.filter((targetName) => targetNames.includes(targetName))
  const unknownNames = targetNames.filter((targetName) => !(targetName in TARGET_ICONS)).sort((left, right) => left.localeCompare(right, 'en'))
  return [...knownNames, ...unknownNames].map((targetName) => ({ targetName, ...targetIconFor(targetName) }))
}
