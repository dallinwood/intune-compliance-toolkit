import type { RegistryHive, RegistrySetting } from '../types/library'
import { registryOdvName, resolveRegistrySetting } from './odv'
import type { OdvValues } from './selectionEntry'

export const LONG_HIVE_NAMES: Record<RegistryHive, string> = {
  HKLM: 'HKEY_LOCAL_MACHINE',
  HKCU: 'HKEY_CURRENT_USER',
  HKU: 'HKEY_USERS',
  HKCR: 'HKEY_CLASSES_ROOT',
}

const HEADER_LINE = 'Windows Registry Editor Version 5.00'
const LINE_BREAK = '\r\n'
const BYTE_ORDER_MARK = [0xff, 0xfe]
const TERMINATOR = [0, 0]

function hexByte(byte: number): string {
  return byte.toString(16).padStart(2, '0')
}

function quoted(text: string): string {
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function utf16LittleEndianBytes(text: string): number[] {
  const bytes: number[] = []
  for (let position = 0; position < text.length; position += 1) {
    const codeUnit = text.charCodeAt(position)
    bytes.push(codeUnit & 0xff, codeUnit >> 8)
  }
  return bytes
}

function hexBytes(prefix: string, bytes: number[]): string {
  return `${prefix}${bytes.map(hexByte).join(',')}`
}

function littleEndianQuadWord(value: bigint): number[] {
  return Array.from({ length: 8 }, (_unused, byteIndex) => Number((value >> BigInt(8 * byteIndex)) & 0xffn))
}

function binaryBytes(hexText: string): number[] {
  return Array.from({ length: hexText.length / 2 }, (_unused, byteIndex) =>
    Number.parseInt(hexText.slice(2 * byteIndex, 2 * byteIndex + 2), 16),
  )
}

function dataText(setting: RegistrySetting): string {
  const { type, data } = setting
  switch (type) {
    case 'REG_DWORD':
      return `dword:${(data as number).toString(16).padStart(8, '0')}`
    case 'REG_QWORD':
      return hexBytes('hex(b):', littleEndianQuadWord(BigInt(data as number)))
    case 'REG_SZ':
      return quoted(data as string)
    case 'REG_EXPAND_SZ':
      return hexBytes('hex(2):', [...utf16LittleEndianBytes(data as string), ...TERMINATOR])
    case 'REG_MULTI_SZ': {
      const terminatedStrings = (data as string[]).flatMap((item) => [...utf16LittleEndianBytes(item), ...TERMINATOR])
      return hexBytes('hex(7):', [...terminatedStrings, ...TERMINATOR])
    }
    case 'REG_BINARY':
      return hexBytes('hex:', binaryBytes(data as string))
    default:
      throw new Error(`A present registry setting needs a type, got ${String(type)}`)
  }
}

function valueLine(setting: RegistrySetting): string {
  const name = setting.value_name === '' ? '@' : quoted(setting.value_name)
  return `${name}=${setting.state === 'absent' ? '-' : dataText(setting)}`
}

function describeSetting(setting: RegistrySetting): string {
  return `The registry setting ${JSON.stringify(`${setting.path}\\${setting.value_name}`)}`
}

const LINE_BREAK_OR_NUL_PATTERN = /[\r\n\0]/

// A line break or NUL in a key path, value name or string would end the line it
// sits on, letting the value that holds it add lines of its own to the file a
// reader imports; a "]" in a path would end the key header early.
function refuseLineInjection(setting: RegistrySetting): void {
  const checkedFields: [string, string][] = [
    ['key path', setting.path],
    ['value name', setting.value_name],
  ]
  if (typeof setting.data === 'string' && setting.type !== 'REG_BINARY') checkedFields.push(['data', setting.data])
  if (Array.isArray(setting.data)) {
    for (const item of setting.data) checkedFields.push(['data', item])
  }
  for (const [fieldName, fieldValue] of checkedFields) {
    if (LINE_BREAK_OR_NUL_PATTERN.test(fieldValue)) {
      throw new Error(`${describeSetting(setting)} has ${fieldName} with a line break or NUL character, which would corrupt the .reg file`)
    }
  }
  if (setting.path.includes(']')) {
    throw new Error(`${describeSetting(setting)} has a key path containing "]", which would end the key header in the .reg file`)
  }
}

function refuseUnresolvedOdv(setting: RegistrySetting): void {
  const odvName = registryOdvName(setting.data)
  if (odvName !== null) {
    throw new Error(`The registry setting ${setting.path}\\${setting.value_name} names the ODV ${odvName}, which has no value (missing)`)
  }
}

// The contents of a .reg file importing the settings, with the reader's
// customised ODV values in place (values as usableOdvValues returns them).
// Keys appear in first-seen order and values in item order. The text has no
// byte order mark; registryFileBytes adds it.
export function registryFileText(settings: RegistrySetting[], odvValues: Partial<OdvValues>): string {
  const linesByKey = new Map<string, string[]>()
  for (const declared of settings) {
    const setting = resolveRegistrySetting(declared, odvValues)
    refuseUnresolvedOdv(setting)
    refuseLineInjection(setting)
    const keyHeader = `[${LONG_HIVE_NAMES[setting.hive]}\\${setting.path}]`
    const lines = linesByKey.get(keyHeader) ?? []
    lines.push(valueLine(setting))
    linesByKey.set(keyHeader, lines)
  }
  const keyBlocks = Array.from(linesByKey, ([keyHeader, lines]) => [keyHeader, ...lines].map((line) => line + LINE_BREAK).join('') + LINE_BREAK)
  return `${HEADER_LINE}${LINE_BREAK}${LINE_BREAK}${keyBlocks.join('')}`
}

// Why registryFileText cannot build the file, as a sentence for the reader, or
// null when it can. Lets the Download button disable itself rather than throw.
export function registryFileProblem(settings: RegistrySetting[], odvValues: Partial<OdvValues>): string | null {
  for (const declared of settings) {
    const odvName = registryOdvName(declared.data)
    if (odvName !== null && !Object.hasOwn(odvValues, odvName)) return `Set a valid value for $ODV_${odvName} to download`
  }
  try {
    registryFileText(settings, odvValues)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

// Regedit reads a UTF-16LE file only when it starts with a byte order mark.
export function registryFileBytes(text: string): Uint8Array {
  return Uint8Array.from([...BYTE_ORDER_MARK, ...utf16LittleEndianBytes(text)])
}

export function registryFileName(ruleId: string, target: string): string {
  return `${ruleId}-${target}.reg`
}
