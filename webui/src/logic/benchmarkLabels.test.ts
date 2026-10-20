import { describe, expect, it } from 'vitest'
import { benchmarkLabel, macosVersionLabel } from './benchmarkLabels'

describe('benchmarkLabel', () => {
  it.each([
    ['cis_lvl1', 'CIS Level 1'],
    ['cis_lvl2', 'CIS Level 2'],
    ['disa_stig', 'DISA STIG'],
    ['nlmapgov_base', 'NLMAPGOV Base'],
    ['nlmapgov_plus', 'NLMAPGOV Plus'],
  ])('labels %s as %s', (name, label) => {
    expect(benchmarkLabel(name)).toBe(label)
  })

  it('returns an unknown name unchanged', () => {
    expect(benchmarkLabel('some_new_benchmark')).toBe('some_new_benchmark')
  })
})

describe('macosVersionLabel', () => {
  it('uses the major version only', () => {
    expect(macosVersionLabel('26.0')).toBe('macOS 26')
    expect(macosVersionLabel('15.0')).toBe('macOS 15')
  })
})
