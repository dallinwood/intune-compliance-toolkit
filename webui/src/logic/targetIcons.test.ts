import appleSvg from 'bootstrap-icons/icons/apple.svg?raw'
import checkCircleFillSvg from 'bootstrap-icons/icons/check-circle-fill.svg?raw'
import clipboardSvg from 'bootstrap-icons/icons/clipboard.svg?raw'
import dashCircleFillSvg from 'bootstrap-icons/icons/dash-circle-fill.svg?raw'
import displaySvg from 'bootstrap-icons/icons/display.svg?raw'
import linkSvg from 'bootstrap-icons/icons/link.svg?raw'
import tuxSvg from 'bootstrap-icons/icons/tux.svg?raw'
import windowsSvg from 'bootstrap-icons/icons/windows.svg?raw'
import { describe, expect, it } from 'vitest'
import { NO_TARGET_KEY } from './applicability'
import { LINK_ICON, NO_TARGET_ICON, STATUS_MARK_ICONS, targetIconsOf } from './targetIcons'

describe('targetIconsOf', () => {
  it('maps macOS, Windows and Linux to their Bootstrap brand logos', () => {
    expect(targetIconsOf(['macOS'])).toEqual([{ targetName: 'macOS', svgMarkup: appleSvg, label: 'macOS' }])
    expect(targetIconsOf(['Windows'])).toEqual([{ targetName: 'Windows', svgMarkup: windowsSvg, label: 'Windows' }])
    expect(targetIconsOf(['Linux'])).toEqual([{ targetName: 'Linux', svgMarkup: tuxSvg, label: 'Linux' }])
  })

  it('paints every logo with currentColor so it follows the theme text colour', () => {
    for (const markup of [appleSvg, windowsSvg, tuxSvg, displaySvg]) expect(markup).toContain('fill="currentColor"')
  })

  it('falls back to the display icon labelled with the raw target name', () => {
    expect(targetIconsOf(['FreeBSD'])).toEqual([{ targetName: 'FreeBSD', svgMarkup: displaySvg, label: 'FreeBSD' }])
  })

  it('shows no icons for a row with no target, and skips the no-target sentinel beside real ones', () => {
    expect(targetIconsOf([NO_TARGET_KEY])).toEqual([])
    expect(targetIconsOf([])).toEqual([])
    expect(targetIconsOf([NO_TARGET_KEY, 'Windows']).map((entry) => entry.label)).toEqual(['Windows'])
  })

  it('lists each target once', () => {
    expect(targetIconsOf(['macOS', 'macOS']).map((entry) => entry.label)).toEqual(['macOS'])
  })

  it('orders known targets by the map, then unknown targets alphabetically', () => {
    expect(targetIconsOf(['Zeta', 'Linux', 'Windows', 'Alpha', 'macOS']).map((entry) => entry.label)).toEqual(['macOS', 'Windows', 'Linux', 'Alpha', 'Zeta'])
  })
})

describe('status glyphs', () => {
  it('the extra glyphs are svg markup painted with currentColor', () => {
    expect(NO_TARGET_ICON).toBe(clipboardSvg)
    expect(LINK_ICON).toBe(linkSvg)
    expect(STATUS_MARK_ICONS).toEqual({ automated: checkCircleFillSvg, manual: dashCircleFillSvg })
    for (const markup of [NO_TARGET_ICON, LINK_ICON, ...Object.values(STATUS_MARK_ICONS)]) {
      expect(markup).toContain('<svg')
      expect(markup).toContain('fill="currentColor"')
    }
  })
})
