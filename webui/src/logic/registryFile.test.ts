import { describe, expect, it } from 'vitest'
import type { RegistrySetting } from '../types/library'
import { registryFileBytes, registryFileName, registryFileText } from './registryFile'

const HEADER = 'Windows Registry Editor Version 5.00\r\n\r\n'

function present(overrides: Partial<RegistrySetting>): RegistrySetting {
  return { hive: 'HKLM', path: 'SOFTWARE\\Example', value_name: 'Setting', type: 'REG_DWORD', data: 1, state: 'present', ...overrides }
}

function absent(overrides: Partial<RegistrySetting> = {}): RegistrySetting {
  return { hive: 'HKLM', path: 'SOFTWARE\\Example', value_name: 'Setting', type: null, data: null, state: 'absent', ...overrides }
}

function singleKeyFile(...valueLines: string[]): string {
  return `${HEADER}[HKEY_LOCAL_MACHINE\\SOFTWARE\\Example]\r\n${valueLines.map((line) => `${line}\r\n`).join('')}\r\n`
}

describe('registryFileText', () => {
  it('writes a DWORD as eight lowercase hex digits', () => {
    expect(registryFileText([present({ data: 10 })], {})).toBe(singleKeyFile('"Setting"=dword:0000000a'))
    expect(registryFileText([present({ data: 4294967295 })], {})).toBe(singleKeyFile('"Setting"=dword:ffffffff'))
  })

  it('writes a QWORD as eight little-endian bytes', () => {
    expect(registryFileText([present({ type: 'REG_QWORD', data: 10 })], {})).toBe(singleKeyFile('"Setting"=hex(b):0a,00,00,00,00,00,00,00'))
    expect(registryFileText([present({ type: 'REG_QWORD', data: 256 })], {})).toBe(singleKeyFile('"Setting"=hex(b):00,01,00,00,00,00,00,00'))
  })

  it('writes a string in quotes, escaping backslashes and double quotes', () => {
    expect(registryFileText([present({ type: 'REG_SZ', data: 'plain' })], {})).toBe(singleKeyFile('"Setting"="plain"'))
    expect(registryFileText([present({ type: 'REG_SZ', data: 'C:\\Dir\\"x"' })], {})).toBe(singleKeyFile('"Setting"="C:\\\\Dir\\\\\\"x\\""'))
  })

  it('writes an expandable string as UTF-16LE bytes with a terminator, including non-ASCII characters', () => {
    expect(registryFileText([present({ type: 'REG_EXPAND_SZ', data: '%A%\u00e9' })], {})).toBe(
      singleKeyFile('"Setting"=hex(2):25,00,41,00,25,00,e9,00,00,00'),
    )
  })

  it('writes a multi-string with a terminator after each string and one more at the end', () => {
    expect(registryFileText([present({ type: 'REG_MULTI_SZ', data: ['a', 'b'] })], {})).toBe(
      singleKeyFile('"Setting"=hex(7):61,00,00,00,62,00,00,00,00,00'),
    )
    expect(registryFileText([present({ type: 'REG_MULTI_SZ', data: [] })], {})).toBe(singleKeyFile('"Setting"=hex(7):00,00'))
  })

  it('writes binary data as lowercase bytes', () => {
    expect(registryFileText([present({ type: 'REG_BINARY', data: '01AB' })], {})).toBe(singleKeyFile('"Setting"=hex:01,ab'))
    expect(registryFileText([present({ type: 'REG_BINARY', data: '' })], {})).toBe(singleKeyFile('"Setting"=hex:'))
  })

  it('deletes an absent value with a dash', () => {
    expect(registryFileText([absent()], {})).toBe(singleKeyFile('"Setting"=-'))
  })

  it('writes the default value as @', () => {
    expect(registryFileText([present({ value_name: '', data: 2 })], {})).toBe(singleKeyFile('@=dword:00000002'))
    expect(registryFileText([absent({ value_name: '' })], {})).toBe(singleKeyFile('@=-'))
  })

  it('escapes a backslash or quote in a value name', () => {
    expect(registryFileText([present({ value_name: 'a\\"b' })], {})).toBe(singleKeyFile('"a\\\\\\"b"=dword:00000001'))
  })

  it('names each long hive', () => {
    const settings = [present({ hive: 'HKCU', path: 'A' }), present({ hive: 'HKU', path: 'B' }), present({ hive: 'HKCR', path: 'C' })]

    expect(registryFileText(settings, {})).toBe(
      `${HEADER}[HKEY_CURRENT_USER\\A]\r\n"Setting"=dword:00000001\r\n\r\n` +
        `[HKEY_USERS\\B]\r\n"Setting"=dword:00000001\r\n\r\n` +
        `[HKEY_CLASSES_ROOT\\C]\r\n"Setting"=dword:00000001\r\n\r\n`,
    )
  })

  it('groups values by key in first-seen order, keeping item order inside a key', () => {
    const settings = [
      present({ path: 'A', value_name: 'one' }),
      present({ path: 'B', value_name: 'two' }),
      present({ path: 'A', value_name: 'three' }),
    ]

    expect(registryFileText(settings, {})).toBe(
      `${HEADER}[HKEY_LOCAL_MACHINE\\A]\r\n"one"=dword:00000001\r\n"three"=dword:00000001\r\n\r\n` +
        `[HKEY_LOCAL_MACHINE\\B]\r\n"two"=dword:00000001\r\n\r\n`,
    )
  })

  it('keeps the same path under different hives as different keys', () => {
    const settings = [present({ hive: 'HKLM', path: 'A' }), present({ hive: 'HKCU', path: 'A' })]

    expect(registryFileText(settings, {})).toContain('[HKEY_LOCAL_MACHINE\\A]')
    expect(registryFileText(settings, {})).toContain('[HKEY_CURRENT_USER\\A]')
  })

  it('does not escape a key path, which may hold a backslash and non-ASCII text', () => {
    expect(registryFileText([present({ path: 'SOFTWARE\\Caf\u00e9' })], {})).toContain('[HKEY_LOCAL_MACHINE\\SOFTWARE\\Caf\u00e9]')
  })

  it('writes the customised value of a number ODV', () => {
    expect(registryFileText([present({ data: '$ODV_timeout' })], { timeout: 900 })).toBe(singleKeyFile('"Setting"=dword:00000384'))
    expect(registryFileText([present({ type: 'REG_QWORD', data: '$ODV_timeout' })], { timeout: 900 })).toBe(
      singleKeyFile('"Setting"=hex(b):84,03,00,00,00,00,00,00'),
    )
  })

  it('writes the customised value of a string ODV, escaped', () => {
    expect(registryFileText([present({ type: 'REG_SZ', data: '$ODV_banner' })], { banner: 'Say "hi"' })).toBe(singleKeyFile('"Setting"="Say \\"hi\\""'))
    expect(registryFileText([present({ type: 'REG_EXPAND_SZ', data: '$ODV_banner' })], { banner: 'x' })).toBe(
      singleKeyFile('"Setting"=hex(2):78,00,00,00'),
    )
  })

  it('refuses a setting whose ODV has no value', () => {
    expect(() => registryFileText([present({ data: '$ODV_missing' })], {})).toThrow('missing')
  })
})

describe('registryFileBytes', () => {
  it('starts with a UTF-16LE byte order mark and round-trips', () => {
    const text = `${HEADER}[HKEY_LOCAL_MACHINE\\Caf\u00e9]\r\n`

    const bytes = registryFileBytes(text)

    expect(Array.from(bytes.slice(0, 2))).toEqual([0xff, 0xfe])
    expect(new TextDecoder('utf-16le').decode(bytes.slice(2))).toBe(text)
    expect(bytes.length).toBe(2 + text.length * 2)
  })
})

describe('registryFileName', () => {
  it('joins the rule id and target', () => {
    expect(registryFileName('cis_windows.1_1_1', 'Windows')).toBe('cis_windows.1_1_1-Windows.reg')
  })
})
