import { describe, expect, it } from 'vitest'
import { macosReferences } from './references'

describe('macosReferences', () => {
  it('turns arrays into values and nested objects into children', () => {
    expect(macosReferences({ nist: { '800-53r5': ['AC-6', 'CM-7'] } })).toEqual([
      {
        key: 'nist',
        values: [],
        children: [{ key: '800-53r5', values: ['AC-6', 'CM-7'], children: [] }],
      },
    ])
  })

  it('keeps only macos_* keys on a level keyed by OS, shown as the raw key', () => {
    const result = macosReferences({
      disa_stig: { ios_17: ['AIOS-17-006500'], macos_15: ['APPL-15-003010'], visionos_26: ['AVOS-26-006500'] },
    })
    expect(result).toEqual([
      {
        key: 'disa_stig',
        values: [],
        children: [{ key: 'macos_15', values: ['APPL-15-003010'], children: [] }],
      },
    ])
  })

  it('drops a node left empty, such as an OS-keyed level with no macOS entry or an empty object', () => {
    expect(macosReferences({ bsi: { indigo: { ios_17: ['ANNEX D'] } }, nist: {} })).toEqual([])
  })

  it('stringifies scalar values', () => {
    expect(macosReferences({ count: 3, name: 'x' })).toEqual([
      { key: 'count', values: ['3'], children: [] },
      { key: 'name', values: ['x'], children: [] },
    ])
  })
})
