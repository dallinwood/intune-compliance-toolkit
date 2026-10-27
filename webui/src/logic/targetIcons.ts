import { Apple, Grid2x2, Monitor, type LucideIcon } from 'lucide-react'
import { NO_TARGET_KEY } from './applicability'

export interface TargetIcon {
  icon: LucideIcon
  label: string
}

// Generic lucide glyphs on purpose: the real brand logos are trademarks.
// Adding a target is one entry here; the entries' order is the display order.
const TARGET_ICONS: Record<string, TargetIcon> = {
  macOS: { icon: Apple, label: 'macOS' },
  Windows: { icon: Grid2x2, label: 'Windows' },
}

const KNOWN_TARGET_NAMES = Object.keys(TARGET_ICONS)

export function targetIconFor(targetName: string): TargetIcon {
  return TARGET_ICONS[targetName] ?? { icon: Monitor, label: targetName }
}

// The icons a row shows: known targets in map order, then unknown targets
// alphabetically. A row with no target at all (an ISM control) gets none.
export function targetIconsOf(targetKeys: readonly string[]): (TargetIcon & { targetName: string })[] {
  const targetNames = Array.from(new Set(targetKeys.filter((targetKey) => targetKey !== NO_TARGET_KEY)))
  const knownNames = KNOWN_TARGET_NAMES.filter((targetName) => targetNames.includes(targetName))
  const unknownNames = targetNames.filter((targetName) => !(targetName in TARGET_ICONS)).sort((left, right) => left.localeCompare(right, 'en'))
  return [...knownNames, ...unknownNames].map((targetName) => ({ targetName, ...targetIconFor(targetName) }))
}
