import appleSvg from 'bootstrap-icons/icons/apple.svg?raw'
import displaySvg from 'bootstrap-icons/icons/display.svg?raw'
import tuxSvg from 'bootstrap-icons/icons/tux.svg?raw'
import windowsSvg from 'bootstrap-icons/icons/windows.svg?raw'
import { NO_TARGET_KEY } from './applicability'

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
