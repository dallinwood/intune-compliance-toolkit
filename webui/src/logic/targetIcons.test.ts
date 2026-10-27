import appleSvg from 'bootstrap-icons/icons/apple.svg?raw'
import displaySvg from 'bootstrap-icons/icons/display.svg?raw'
import tuxSvg from 'bootstrap-icons/icons/tux.svg?raw'
import windowsSvg from 'bootstrap-icons/icons/windows.svg?raw'
import { describe, expect, it } from 'vitest'
import { NO_TARGET_KEY } from './applicability'
import { targetIconsOf } from './targetIcons'

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
