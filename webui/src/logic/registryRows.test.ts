import { describe, expect, it } from 'vitest'
import type { RegistrySetting } from '../types/library'
import { registryRows } from './registryRows'

function present(overrides: Partial<RegistrySetting>): RegistrySetting {
  return { hive: 'HKLM', path: 'SOFTWARE\\Example', value_name: 'Setting', type: 'REG_DWORD', data: 1, state: 'present', ...overrides }
}

describe('registryRows', () => {
  it('describes a DWORD setting', () => {
    expect(registryRows([present({ data: 4294967295 })], {})).toEqual([
      {
        hive: 'HKLM',
        path: 'SOFTWARE\\Example',
        fullPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Example',
        valueName: 'Setting',
        type: 'REG_DWORD',
        data: '4294967295',
        odvName: null,
        action: 'Set',
      },
    ])
  })

  it('shows a QWORD in decimal', () => {
    expect(registryRows([present({ type: 'REG_QWORD', data: 1099511627776 })], {})[0].data).toBe('1099511627776')
  })

  it('shows a string as it is, backslashes included', () => {
    expect(registryRows([present({ type: 'REG_SZ', data: 'C:\\x "y"' })], {})[0].data).toBe('C:\\x "y"')
  })

  it('joins a multi-string with newlines', () => {
    expect(registryRows([present({ type: 'REG_MULTI_SZ', data: ['a', 'b'] })], {})[0].data).toBe('a\nb')
  })

  it('spaces binary data in byte pairs', () => {
    expect(registryRows([present({ type: 'REG_BINARY', data: '01ab02' })], {})[0].data).toBe('01 ab 02')
    expect(registryRows([present({ type: 'REG_BINARY', data: '' })], {})[0].data).toBe('')
  })

  it('shows an absent setting as a deletion with no type or data', () => {
    const row = registryRows([{ hive: 'HKCU', path: 'A', value_name: 'x', type: null, data: null, state: 'absent' }], {})[0]

    expect(row).toMatchObject({ type: '', data: '', action: 'Delete', odvName: null, fullPath: 'HKEY_CURRENT_USER\\A' })
  })

  it('shows the default value as (Default)', () => {
    expect(registryRows([present({ value_name: '' })], {})[0].valueName).toBe('(Default)')
  })

  it('shows a customised ODV value and names the ODV', () => {
    const rows = registryRows([present({ data: '$ODV_timeout' }), present({ type: 'REG_SZ', data: '$ODV_banner' })], {
      timeout: 900,
      banner: 'Hello',
    })

    expect(rows.map((row) => [row.data, row.odvName])).toEqual([
      ['900', 'timeout'],
      ['Hello', 'banner'],
    ])
  })

  it('shows the placeholder when the ODV has no value yet', () => {
    expect(registryRows([present({ data: '$ODV_timeout' })], {})[0]).toMatchObject({ data: '$ODV_timeout', odvName: 'timeout' })
  })

  it('keeps item order', () => {
    expect(registryRows([present({ value_name: 'b' }), present({ value_name: 'a' })], {}).map((row) => row.valueName)).toEqual(['b', 'a'])
  })
})
